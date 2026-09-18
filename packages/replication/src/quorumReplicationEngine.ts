import * as grpc from '@grpc/grpc-js';
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
import { LocalNodeOperations } from './syncReplicationEngine.js';
import { MembershipSnapshot } from '@quorum-lab/contracts';
import {
  VersionedEntry,
  toVersionFrontier,
  applyIncomingEntry,
  satisfiesCausalDependency,
  VersionFrontier
} from '@quorum-lab/consistency';
import { resolveLwwWinner } from './lwwResolver.js';
import {
  ReadRepairCoordinator,
  detectStaleReplicas,
  ReplicaReadResult,
  HintedHandoffManager
} from '@quorum-lab/repair';

export interface QuorumConfig {
  readonly W: number;
  readonly R: number;
}

export class QuorumWriteError extends Error {
  public readonly requiredAcks: number;
  public readonly obtainedAcks: number;

  constructor(message: string, requiredAcks: number, obtainedAcks: number) {
    super(message);
    this.name = 'QuorumWriteError';
    this.requiredAcks = requiredAcks;
    this.obtainedAcks = obtainedAcks;
  }
}

export class QuorumReadError extends Error {
  public readonly requiredAcks: number;
  public readonly obtainedAcks: number;

  constructor(message: string, requiredAcks: number, obtainedAcks: number) {
    super(message);
    this.name = 'QuorumReadError';
    this.requiredAcks = requiredAcks;
    this.obtainedAcks = obtainedAcks;
  }
}

export class CausalConsistencyError extends Error {
  public readonly requiredDependency: Record<string, number>;
  public readonly currentFrontier: VersionFrontier;

  constructor(message: string, dependency: Record<string, number>, frontier: VersionFrontier) {
    super(message);
    this.name = 'CausalConsistencyError';
    this.requiredDependency = dependency;
    this.currentFrontier = frontier;
  }
}

export class QuorumReplicationEngine implements ReplicationEngine {
  private readonly localNodeId: string;
  private readonly localOps: LocalNodeOperations;
  private readonly peerPool: PeerClientPool;
  private readonly getMembership: () => MembershipSnapshot;
  private readonly quorumConfig: QuorumConfig;
  public readonly readRepairCoordinator?: ReadRepairCoordinator;
  public readonly hintedHandoffManager?: HintedHandoffManager;

  constructor(params: {
    localNodeId: string;
    localOps: LocalNodeOperations;
    peerPool: PeerClientPool;
    getMembership: () => MembershipSnapshot;
    quorumConfig: QuorumConfig;
    readRepairCoordinator?: ReadRepairCoordinator;
    hintedHandoffManager?: HintedHandoffManager;
  }) {
    this.localNodeId = params.localNodeId;
    this.localOps = params.localOps;
    this.peerPool = params.peerPool;
    this.getMembership = params.getMembership;
    this.quorumConfig = params.quorumConfig;
    this.readRepairCoordinator = params.readRepairCoordinator;
    this.hintedHandoffManager = params.hintedHandoffManager;
  }

  public getQuorumConfig(): QuorumConfig {
    return this.quorumConfig;
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

    const { W } = this.quorumConfig;
    const acks: ReplicaAckInfo[] = [localAck];
    let ackCount = 1;

    const membership = this.getMembership();
    const peers = membership.members.filter((id) => id !== this.localNodeId);

    const entry: VersionedEntry = {
      value: params.value,
      tombstone: false,
      version: localRes.version
    };

    if (ackCount >= W) {
      // W=1: Quorum satisfied by local write. Replicate to peers in background.
      for (const peerId of peers) {
        this.peerPool.replicateToPeer({
          peerNodeId: peerId,
          sourceNodeId: this.localNodeId,
          key: params.key,
          entry,
          operationId: params.operationId,
          requestId: params.requestId,
          membership
        }).then((pAck) => {
          if (!pAck.replicaAcked && this.hintedHandoffManager) {
            this.hintedHandoffManager.storeHint({
              targetNodeId: peerId,
              key: params.key,
              entry,
              operationId: params.operationId,
              requestId: params.requestId
            }).catch(() => {});
          }
        }).catch(() => {
          if (this.hintedHandoffManager) {
            this.hintedHandoffManager.storeHint({
              targetNodeId: peerId,
              key: params.key,
              entry,
              operationId: params.operationId,
              requestId: params.requestId
            }).catch(() => {});
          }
        });
      }

      return {
        version: localRes.version,
        frontier: localRes.frontier,
        replicaAcks: acks,
        totalReplicaAcks: 1,
        totalDurableAcks: localAck.durableAcked ? 1 : 0,
        isDuplicate: false
      };
    }

    // W > 1: Collect ACKs from peers until W is satisfied
    const peerPromises = peers.map((peerId) =>
      this.peerPool.replicateToPeer({
        peerNodeId: peerId,
        sourceNodeId: this.localNodeId,
        key: params.key,
        entry,
        operationId: params.operationId,
        requestId: params.requestId,
        membership
      }).then((pAck) => {
        if (!pAck.replicaAcked && this.hintedHandoffManager) {
          this.hintedHandoffManager.storeHint({
            targetNodeId: peerId,
            key: params.key,
            entry,
            operationId: params.operationId,
            requestId: params.requestId
          }).catch(() => {});
        }
        return pAck;
      }).catch((err) => {
        if (this.hintedHandoffManager) {
          this.hintedHandoffManager.storeHint({
            targetNodeId: peerId,
            key: params.key,
            entry,
            operationId: params.operationId,
            requestId: params.requestId
          }).catch(() => {});
        }
        return {
          nodeId: peerId,
          replicaAcked: false,
          durableAcked: false,
          latencyMs: 0,
          error: err?.message ?? 'Peer replication failed'
        };
      })
    );

    const peerAcks = await Promise.all(peerPromises);
    for (const pAck of peerAcks) {
      acks.push(pAck);
      if (pAck.replicaAcked) {
        ackCount++;
      }
    }

    const totalReplicaAcks = acks.filter((a) => a.replicaAcked).length;
    const totalDurableAcks = acks.filter((a) => a.durableAcked).length;

    if (totalReplicaAcks < W) {
      throw new QuorumWriteError(
        `Quorum write requirement W=${W} not satisfied; only ${totalReplicaAcks} replicas acknowledged`,
        W,
        totalReplicaAcks
      );
    }

    return {
      version: localRes.version,
      frontier: localRes.frontier,
      replicaAcks: acks,
      totalReplicaAcks,
      totalDurableAcks,
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

    const { W } = this.quorumConfig;
    const acks: ReplicaAckInfo[] = [localAck];

    const membership = this.getMembership();
    const peers = membership.members.filter((id) => id !== this.localNodeId);

    const entry: VersionedEntry = {
      value: null,
      tombstone: true,
      version: localRes.tombstoneVersion
    };

    if (W === 1) {
      for (const peerId of peers) {
        this.peerPool.replicateToPeer({
          peerNodeId: peerId,
          sourceNodeId: this.localNodeId,
          key: params.key,
          entry,
          operationId: params.operationId,
          requestId: params.requestId,
          membership
        }).catch(() => {});
      }

      return {
        version: localRes.tombstoneVersion,
        frontier: localRes.frontier,
        replicaAcks: acks,
        totalReplicaAcks: 1,
        totalDurableAcks: localAck.durableAcked ? 1 : 0,
        isDuplicate: false
      };
    }

    const peerAcks = await Promise.all(
      peers.map((peerId) =>
        this.peerPool.replicateToPeer({
          peerNodeId: peerId,
          sourceNodeId: this.localNodeId,
          key: params.key,
          entry,
          operationId: params.operationId,
          requestId: params.requestId,
          membership
        })
      )
    );

    for (const pAck of peerAcks) {
      acks.push(pAck);
    }

    const totalReplicaAcks = acks.filter((a) => a.replicaAcked).length;
    const totalDurableAcks = acks.filter((a) => a.durableAcked).length;

    if (totalReplicaAcks < W) {
      throw new QuorumWriteError(
        `Quorum write requirement W=${W} not satisfied; only ${totalReplicaAcks} replicas acknowledged`,
        W,
        totalReplicaAcks
      );
    }

    return {
      version: localRes.tombstoneVersion,
      frontier: localRes.frontier,
      replicaAcks: acks,
      totalReplicaAcks,
      totalDurableAcks,
      isDuplicate: false
    };
  }

  public async get(params: ReplicationGetParams): Promise<ReplicationGetResult> {
    const localRes = this.localOps.get(params);
    let mergedEntries = [...localRes.keyState.entries];

    const { R } = this.quorumConfig;
    const localFrontier = toVersionFrontier(localRes.keyState);
    const satisfiesCausalLocally =
      !params.causalDependency || satisfiesCausalDependency(localFrontier, params.causalDependency);

    if (R <= 1 && satisfiesCausalLocally) {
      // Local read satisfies causal dependency and quorum size requirement
      let projectedEntries: readonly VersionedEntry[];
      if (params.conflictStrategy === 'MULTI_VALUE' || params.conflictStrategy === 'VERSION_VECTOR') {
        projectedEntries = mergedEntries;
      } else {
        const winner = resolveLwwWinner(mergedEntries);
        projectedEntries = winner ? [winner] : [];
      }
      return {
        keyState: { key: params.key, entries: projectedEntries },
        frontier: localFrontier
      };
    }

    // Query peers to collect R responses (or to satisfy causal dependency)
    const membership = this.getMembership();
    const peers = membership.members.filter((id) => id !== this.localNodeId);

    const replicaResponses: ReplicaReadResult[] = [
      { nodeId: this.localNodeId, entries: localRes.keyState.entries }
    ];

    const peerResults = await Promise.all(
      peers.map(async (peerId) => {
        const client = this.peerPool.getPeerClient(peerId);
        if (!client) return { peerId, resp: null };

        return new Promise<{ peerId: string; resp: any }>((resolve) => {
          const metadata = new grpc.Metadata();
          metadata.set('x-internal-quorum-read', 'true');

          client.Get(
            { key: params.key },
            metadata,
            { deadline: new Date(Date.now() + 3000) },
            (err: any, resp: any) => {
              if (err || !resp || !resp.key_state) {
                resolve({ peerId, resp: null });
              } else {
                resolve({ peerId, resp });
              }
            }
          );
        });
      })
    );

    let responsesCount = 1; // local node is 1
    for (const p of peerResults) {
      if (p && p.resp && p.resp.key_state && p.resp.key_state.entries) {
        responsesCount++;
        const parsedPeerEntries: VersionedEntry[] = [];
        for (const rawEntry of p.resp.key_state.entries) {
          const parsedVc: Record<string, number> = {};
          if (rawEntry.version?.vector_clock?.entries) {
            for (const [k, v] of Object.entries(rawEntry.version.vector_clock.entries)) {
              parsedVc[k] = Number(v);
            }
          }

          const entry: VersionedEntry = {
            value: rawEntry.value && rawEntry.value.length > 0 ? new Uint8Array(rawEntry.value) : null,
            tombstone: Boolean(rawEntry.tombstone),
            version: {
              dot: {
                nodeId: rawEntry.version.dot.node_id,
                counter: Number(rawEntry.version.dot.counter)
              },
              vectorClock: parsedVc,
              lamport: Number(rawEntry.version.lamport),
              wallTimeMs: Number(rawEntry.version.wall_time_ms)
            }
          };
          parsedPeerEntries.push(entry);
          mergedEntries = [...applyIncomingEntry(mergedEntries, entry)];
        }
        replicaResponses.push({ nodeId: p.peerId, entries: parsedPeerEntries });
      }
    }

    if (responsesCount < R) {
      throw new QuorumReadError(
        `Quorum read requirement R=${R} not satisfied; only ${responsesCount} replicas responded`,
        R,
        responsesCount
      );
    }

    const finalFrontier = toVersionFrontier({ key: params.key, entries: mergedEntries });

    // Read Repair: Piggyback repair asynchronously on quorum read mismatches (§Q6)
    if (this.readRepairCoordinator && R >= 2 && responsesCount >= 2) {
      const staleNodeIds = detectStaleReplicas(replicaResponses, mergedEntries);
      if (staleNodeIds.length > 0) {
        this.readRepairCoordinator.executeReadRepairAsync({
          key: params.key,
          undominatedEntries: mergedEntries,
          staleNodeIds,
          coordinatorNodeId: this.localNodeId,
          peerPool: this.peerPool,
          membership
        });
      }
    }

    if (params.causalDependency && !satisfiesCausalDependency(finalFrontier, params.causalDependency)) {
      throw new CausalConsistencyError(
        `Causal dependency not satisfied for key ${params.key}`,
        params.causalDependency,
        finalFrontier
      );
    }

    // Project entries according to conflict strategy
    let projectedEntries: readonly VersionedEntry[];
    if (params.conflictStrategy === 'MULTI_VALUE' || params.conflictStrategy === 'VERSION_VECTOR') {
      projectedEntries = mergedEntries;
    } else {
      const winner = resolveLwwWinner(mergedEntries);
      projectedEntries = winner ? [winner] : [];
    }

    return {
      keyState: {
        key: params.key,
        entries: projectedEntries
      },
      frontier: finalFrontier
    };
  }

  public async close(): Promise<void> {
    await this.peerPool.close();
  }
}
