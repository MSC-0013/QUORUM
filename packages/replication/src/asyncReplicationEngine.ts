import {
  ReplicationEngine,
  ReplicationPutParams,
  ReplicationDeleteParams,
  ReplicationGetParams,
  ReplicationResult,
  ReplicationGetResult,
  ReplicaAckInfo
} from './types.js';
import { PeerClientPool } from './peerClient.js';
import { MembershipSnapshot } from '@quorum-lab/contracts';
import { VersionedEntry } from '@quorum-lab/consistency';
import { LocalNodeOperations } from './syncReplicationEngine.js';

export class AsyncReplicationEngine implements ReplicationEngine {
  private readonly localNodeId: string;
  private readonly localOps: LocalNodeOperations;
  private readonly peerPool: PeerClientPool;
  private readonly getMembership: () => MembershipSnapshot;
  private pendingReplications = 0;

  constructor(params: {
    localNodeId: string;
    localOps: LocalNodeOperations;
    peerPool: PeerClientPool;
    getMembership: () => MembershipSnapshot;
  }) {
    this.localNodeId = params.localNodeId;
    this.localOps = params.localOps;
    this.peerPool = params.peerPool;
    this.getMembership = params.getMembership;
  }

  public getPendingReplicationsCount(): number {
    return this.pendingReplications;
  }

  public async put(params: ReplicationPutParams): Promise<ReplicationResult> {
    const localStart = process.hrtime.bigint();
    const localRes = await this.localOps.put(params);
    const localElapsedNs = process.hrtime.bigint() - localStart;
    const localLatencyMs = Number(localElapsedNs) / 1_000_000;

    const localAck: ReplicaAckInfo = {
      nodeId: this.localNodeId,
      replicaAcked: true,
      durableAcked: this.localOps.isDurable(),
      latencyMs: localLatencyMs
    };

    if (localRes.isDuplicate) {
      return {
        version: localRes.version,
        frontier: localRes.frontier,
        replicaAcks: [localAck],
        totalReplicaAcks: 1,
        totalDurableAcks: localAck.durableAcked ? 1 : 0,
        isDuplicate: true
      };
    }

    const membership = this.getMembership();
    const peers = membership.members.filter((id) => id !== this.localNodeId);

    const entry: VersionedEntry = {
      value: params.value,
      tombstone: false,
      version: localRes.version
    };

    // Fan-out asynchronously in the background (fire-and-forget for client latency)
    this.pendingReplications += peers.length;
    for (const peerId of peers) {
      this.peerPool
        .replicateToPeer({
          peerNodeId: peerId,
          sourceNodeId: this.localNodeId,
          key: params.key,
          entry,
          operationId: params.operationId,
          requestId: params.requestId,
          membership
        })
        .finally(() => {
          this.pendingReplications = Math.max(0, this.pendingReplications - 1);
        });
    }

    // Returns immediately after local ACK
    return {
      version: localRes.version,
      frontier: localRes.frontier,
      replicaAcks: [localAck],
      totalReplicaAcks: 1,
      totalDurableAcks: localAck.durableAcked ? 1 : 0,
      isDuplicate: false
    };
  }

  public async delete(params: ReplicationDeleteParams): Promise<ReplicationResult> {
    const localStart = process.hrtime.bigint();
    const localRes = await this.localOps.delete(params);
    const localElapsedNs = process.hrtime.bigint() - localStart;
    const localLatencyMs = Number(localElapsedNs) / 1_000_000;

    const localAck: ReplicaAckInfo = {
      nodeId: this.localNodeId,
      replicaAcked: true,
      durableAcked: this.localOps.isDurable(),
      latencyMs: localLatencyMs
    };

    if (localRes.isDuplicate) {
      return {
        version: localRes.tombstoneVersion,
        frontier: localRes.frontier,
        replicaAcks: [localAck],
        totalReplicaAcks: 1,
        totalDurableAcks: localAck.durableAcked ? 1 : 0,
        isDuplicate: true
      };
    }

    const membership = this.getMembership();
    const peers = membership.members.filter((id) => id !== this.localNodeId);

    const entry: VersionedEntry = {
      value: null,
      tombstone: true,
      version: localRes.tombstoneVersion
    };

    this.pendingReplications += peers.length;
    for (const peerId of peers) {
      this.peerPool
        .replicateToPeer({
          peerNodeId: peerId,
          sourceNodeId: this.localNodeId,
          key: params.key,
          entry,
          operationId: params.operationId,
          requestId: params.requestId,
          membership
        })
        .finally(() => {
          this.pendingReplications = Math.max(0, this.pendingReplications - 1);
        });
    }

    return {
      version: localRes.tombstoneVersion,
      frontier: localRes.frontier,
      replicaAcks: [localAck],
      totalReplicaAcks: 1,
      totalDurableAcks: localAck.durableAcked ? 1 : 0,
      isDuplicate: false
    };
  }

  public async get(params: ReplicationGetParams): Promise<ReplicationGetResult> {
    const res = this.localOps.get(params);
    return {
      keyState: res.keyState,
      frontier: res.frontier
    };
  }

  public async close(): Promise<void> {
    await this.peerPool.close();
  }
}
