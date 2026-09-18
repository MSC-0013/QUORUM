import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { PROTO_DIR } from '@quorum-lab/protocol';
import { VersionedEntry } from '@quorum-lab/consistency';
import { MembershipSnapshot } from '@quorum-lab/contracts';
import { ReplicaAckInfo } from './types.js';

export interface PeerEndpoint {
  readonly nodeId: string;
  readonly address: string; // e.g. "127.0.0.1:50052"
}

export type NetworkFaultInterceptor = (params: {
  sourceNodeId: string;
  peerNodeId: string;
}) =>
  | Promise<{ allow: boolean; delayMs?: number; drop?: boolean; error?: string }>
  | { allow: boolean; delayMs?: number; drop?: boolean; error?: string };

export class PeerClientPool {
  private readonly clients = new Map<string, any>();
  private readonly NodeServiceConstructor: any;
  private faultInterceptor?: NetworkFaultInterceptor;

  constructor() {
    const nodePackageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'node.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR]
    });
    const loaded = grpc.loadPackageDefinition(nodePackageDef) as any;
    this.NodeServiceConstructor = loaded.quorum.node.v1.NodeService;
  }

  public setFaultInterceptor(interceptor?: NetworkFaultInterceptor): void {
    this.faultInterceptor = interceptor;
  }

  public registerPeer(endpoint: PeerEndpoint): void {
    if (!this.clients.has(endpoint.nodeId)) {
      const client = new this.NodeServiceConstructor(
        endpoint.address,
        grpc.credentials.createInsecure()
      );
      this.clients.set(endpoint.nodeId, client);
    }
  }

  public getPeerClient(nodeId: string): any {
    return this.clients.get(nodeId);
  }

  public async replicateToPeer(params: {
    peerNodeId: string;
    sourceNodeId: string;
    key: string;
    entry: VersionedEntry;
    operationId: string;
    requestId: string;
    membership: MembershipSnapshot;
    fencingEpoch?: number;
    timeoutMs?: number;
  }): Promise<ReplicaAckInfo> {
    const client = this.clients.get(params.peerNodeId);
    if (!client) {
      return {
        nodeId: params.peerNodeId,
        replicaAcked: false,
        durableAcked: false,
        latencyMs: 0,
        error: `Peer ${params.peerNodeId} not registered in peer client pool`
      };
    }

    if (this.faultInterceptor) {
      const fault = await this.faultInterceptor({
        sourceNodeId: params.sourceNodeId,
        peerNodeId: params.peerNodeId
      });

      if (!fault.allow || fault.drop) {
        return {
          nodeId: params.peerNodeId,
          replicaAcked: false,
          durableAcked: false,
          latencyMs: 0,
          error: fault.error ?? 'Replication dropped by fault injector'
        };
      }

      if (fault.delayMs && fault.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, fault.delayMs));
      }
    }

    const start = process.hrtime.bigint();
    const deadline = new Date(Date.now() + (params.timeoutMs ?? 5000));

    return new Promise<ReplicaAckInfo>((resolve) => {
      client.Replicate(
        {
          operation_id: params.operationId,
          request_id: params.requestId,
          source_node: params.sourceNodeId,
          key: params.key,
          entry: {
            value: params.entry.value ? Buffer.from(params.entry.value) : Buffer.alloc(0),
            tombstone: params.entry.tombstone,
            version: {
              dot: {
                node_id: params.entry.version.dot.nodeId,
                counter: params.entry.version.dot.counter
              },
              vector_clock: {
                entries: params.entry.version.vectorClock
              },
              lamport: params.entry.version.lamport,
              wall_time_ms: params.entry.version.wallTimeMs
            }
          },
          fencing_epoch: params.fencingEpoch ?? 0,
          membership_version: params.membership.version,
          membership_hash: params.membership.hash
        },
        { deadline },
        (err: any, resp: any) => {
          const elapsedNs = process.hrtime.bigint() - start;
          const latencyMs = Number(elapsedNs) / 1_000_000;

          if (err) {
            resolve({
              nodeId: params.peerNodeId,
              replicaAcked: false,
              durableAcked: false,
              latencyMs,
              error: err.message
            });
            return;
          }

          if (resp.status && resp.status.code !== 1 && resp.status.code !== 'STATUS_CODE_OK') {
            resolve({
              nodeId: params.peerNodeId,
              replicaAcked: false,
              durableAcked: false,
              latencyMs,
              error: resp.status.message || `Replication rejected with code ${resp.status.code}`
            });
            return;
          }

          resolve({
            nodeId: params.peerNodeId,
            replicaAcked: true,
            durableAcked: Boolean(resp.durable_acked),
            latencyMs
          });
        }
      );
    });
  }

  public async prepareWriteOnPeer(params: {
    peerNodeId: string;
    key: string;
    value: Uint8Array;
    epoch: number;
    leaderId: string;
    timeoutMs?: number;
  }): Promise<{ status: number; message?: string }> {
    const client = this.clients.get(params.peerNodeId);
    if (!client) {
      return { status: 10, message: `Peer ${params.peerNodeId} not registered in peer client pool` };
    }

    const deadline = new Date(Date.now() + (params.timeoutMs ?? 5000));
    return new Promise((resolve) => {
      client.PrepareWrite(
        {
          key: params.key,
          value: Buffer.from(params.value),
          epoch: params.epoch,
          leader_id: params.leaderId
        },
        { deadline },
        (err: any, resp: any) => {
          if (err) {
            resolve({ status: 10, message: err.message });
            return;
          }
          const rawCode = resp?.status?.code;
          let statusCode = 1;
          if (typeof rawCode === 'number') {
            statusCode = rawCode;
          } else if (rawCode === 'STATUS_CODE_FENCED') {
            statusCode = 7;
          } else if (rawCode === 'STATUS_CODE_OK') {
            statusCode = 1;
          } else if (rawCode) {
            statusCode = Number(rawCode) || 1;
          }

          resolve({
            status: statusCode,
            message: resp?.status?.message
          });
        }
      );
    });
  }

  public async commitWriteOnPeer(params: {
    peerNodeId: string;
    key: string;
    epoch: number;
    leaderId: string;
    timeoutMs?: number;
  }): Promise<{ status: number; message?: string }> {
    const client = this.clients.get(params.peerNodeId);
    if (!client) {
      return { status: 10, message: `Peer ${params.peerNodeId} not registered in peer client pool` };
    }

    const deadline = new Date(Date.now() + (params.timeoutMs ?? 5000));
    return new Promise((resolve) => {
      client.CommitWrite(
        {
          key: params.key,
          epoch: params.epoch,
          leader_id: params.leaderId
        },
        { deadline },
        (err: any, resp: any) => {
          if (err) {
            resolve({ status: 10, message: err.message });
            return;
          }
          const rawCode = resp?.status?.code;
          let statusCode = 1;
          if (typeof rawCode === 'number') {
            statusCode = rawCode;
          } else if (rawCode === 'STATUS_CODE_FENCED') {
            statusCode = 7;
          } else if (rawCode === 'STATUS_CODE_OK') {
            statusCode = 1;
          } else if (rawCode) {
            statusCode = Number(rawCode) || 1;
          }

          resolve({
            status: statusCode,
            message: resp?.status?.message
          });
        }
      );
    });
  }

  public async close(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {
        // Ignore closing errors
      }
    }
    this.clients.clear();
  }
}
