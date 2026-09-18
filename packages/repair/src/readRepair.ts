import { VersionedEntry, entryDominates, versionStampsEqual } from '@quorum-lab/consistency';
import { MembershipSnapshot } from '@quorum-lab/contracts';

export interface PeerReplicator {
  replicateToPeer(params: {
    peerNodeId: string;
    sourceNodeId: string;
    key: string;
    entry: VersionedEntry;
    operationId: string;
    requestId: string;
    membership: MembershipSnapshot;
    fencingEpoch?: number;
  }): Promise<{ replicaAcked: boolean; error?: string }>;
}

export interface ReadRepairMetrics {
  repairsTriggered: number;
  repairsSucceeded: number;
  repairsFailed: number;
}

export interface ReplicaReadResult {
  readonly nodeId: string;
  readonly entries: readonly VersionedEntry[];
}

/**
 * Determines which replicas returned stale or incomplete state compared to undominated maximal entries.
 */
export function detectStaleReplicas(
  replicaResponses: readonly ReplicaReadResult[],
  undominatedEntries: readonly VersionedEntry[]
): string[] {
  if (undominatedEntries.length === 0) {
    return [];
  }

  const staleNodeIds: string[] = [];

  for (const resp of replicaResponses) {
    let isStale = false;

    // 1. If replica has no entries but undominated entries exist, it is missing the key
    if (resp.entries.length === 0) {
      staleNodeIds.push(resp.nodeId);
      continue;
    }

    // 2. If any entry on this replica is strictly dominated by an undominated entry
    for (const replicaEntry of resp.entries) {
      for (const winningEntry of undominatedEntries) {
        if (entryDominates(winningEntry, replicaEntry)) {
          isStale = true;
          break;
        }
      }
      if (isStale) break;
    }

    // 3. If replica is missing any of the undominated maximal versions
    if (!isStale) {
      for (const winningEntry of undominatedEntries) {
        const found = resp.entries.some((e) => versionStampsEqual(e.version, winningEntry.version));
        if (!found) {
          isStale = true;
          break;
        }
      }
    }

    if (isStale) {
      staleNodeIds.push(resp.nodeId);
    }
  }

  return staleNodeIds;
}

export interface ReadRepairExecutionParams {
  readonly key: string;
  readonly undominatedEntries: readonly VersionedEntry[];
  readonly staleNodeIds: readonly string[];
  readonly coordinatorNodeId: string;
  readonly peerPool: PeerReplicator;
  readonly membership: MembershipSnapshot;
  readonly fencingEpoch?: number;
}

export class ReadRepairCoordinator {
  private readonly metrics: ReadRepairMetrics = {
    repairsTriggered: 0,
    repairsSucceeded: 0,
    repairsFailed: 0
  };

  public getMetrics(): ReadRepairMetrics {
    return { ...this.metrics };
  }

  /**
   * Fires background read repair requests to all stale replicas.
   * Runs asynchronously without blocking the coordinator's client read response.
   */
  public executeReadRepairAsync(params: ReadRepairExecutionParams): void {
    if (params.staleNodeIds.length === 0 || params.undominatedEntries.length === 0) {
      return;
    }

    this.metrics.repairsTriggered += params.staleNodeIds.length;

    // Dispatch repairs concurrently in the background
    Promise.allSettled(
      params.staleNodeIds.map(async (targetNodeId) => {
        for (const entry of params.undominatedEntries) {
          const ack = await params.peerPool.replicateToPeer({
            peerNodeId: targetNodeId,
            sourceNodeId: params.coordinatorNodeId,
            key: params.key,
            entry,
            operationId: `repair-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            requestId: `req-repair-${targetNodeId}`,
            membership: params.membership,
            fencingEpoch: params.fencingEpoch ?? 0
          });

          if (!ack.replicaAcked) {
            throw new Error(`Read repair failed for ${targetNodeId}: ${ack.error}`);
          }
        }
      })
    ).then((results) => {
      for (const r of results) {
        if (r.status === 'fulfilled') {
          this.metrics.repairsSucceeded += 1;
        } else {
          this.metrics.repairsFailed += 1;
        }
      }
    });
  }
}
