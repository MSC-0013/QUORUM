import { VersionedEntry } from '@quorum-lab/consistency';
import { MembershipSnapshot } from '@quorum-lab/contracts';
import { StorageEngine } from '@quorum-lab/storage';
import { PeerReplicator } from './readRepair.js';

export interface HintRecord {
  readonly hintId: string;
  readonly targetNodeId: string;
  readonly key: string;
  readonly entry: VersionedEntry;
  readonly createdAtMs: number;
  readonly operationId: string;
  readonly requestId: string;
}

export interface HintedHandoffMetrics {
  hintsStored: number;
  hintsReplayed: number;
  hintsFailed: number;
  hintsPending: number;
}

export class HintStore {
  private readonly hints = new Map<string, HintRecord>();
  private readonly storage?: StorageEngine;

  constructor(storage?: StorageEngine) {
    this.storage = storage;
  }

  public async recordHint(hint: HintRecord): Promise<void> {
    this.hints.set(hint.hintId, hint);

    if (this.storage) {
      await this.storage.appendHint({
        hintId: hint.hintId,
        targetNodeId: hint.targetNodeId,
        key: hint.key,
        value: hint.entry.value,
        tombstone: hint.entry.tombstone,
        version: hint.entry.version,
        operationId: hint.operationId,
        requestId: hint.requestId,
        createdAtMs: hint.createdAtMs
      });
    }
  }

  public getPendingHintsForNode(nodeId: string): HintRecord[] {
    const list: HintRecord[] = [];
    for (const hint of this.hints.values()) {
      if (hint.targetNodeId === nodeId) {
        list.push(hint);
      }
    }
    return list.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  public getAllPendingHints(): HintRecord[] {
    return Array.from(this.hints.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  public removeHint(hintId: string): void {
    this.hints.delete(hintId);
  }

  public getPendingCount(): number {
    return this.hints.size;
  }
}

export class HintedHandoffManager {
  private readonly store: HintStore;
  private readonly metrics: HintedHandoffMetrics = {
    hintsStored: 0,
    hintsReplayed: 0,
    hintsFailed: 0,
    hintsPending: 0
  };
  constructor(store?: HintStore) {
    this.store = store ?? new HintStore();
  }

  public getStore(): HintStore {
    return this.store;
  }

  public getMetrics(): HintedHandoffMetrics {
    return {
      ...this.metrics,
      hintsPending: this.store.getPendingCount()
    };
  }

  /**
   * Captures an undelivered mutation as a durable hint destined for an unreachable peer.
   */
  public async storeHint(params: {
    targetNodeId: string;
    key: string;
    entry: VersionedEntry;
    operationId: string;
    requestId: string;
  }): Promise<HintRecord> {
    const hint: HintRecord = {
      hintId: `hint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      targetNodeId: params.targetNodeId,
      key: params.key,
      entry: params.entry,
      createdAtMs: Date.now(),
      operationId: params.operationId,
      requestId: params.requestId
    };

    await this.store.recordHint(hint);
    this.metrics.hintsStored += 1;
    return hint;
  }

  /**
   * Replays pending hints to a target peer that has reconnected or recovered.
   */
  public async replayHintsForNode(params: {
    targetNodeId: string;
    sourceNodeId: string;
    peerPool: PeerReplicator;
    membership: MembershipSnapshot;
  }): Promise<{ replayed: number; failed: number }> {
    const pending = this.store.getPendingHintsForNode(params.targetNodeId);
    if (pending.length === 0) {
      return { replayed: 0, failed: 0 };
    }

    let replayed = 0;
    let failed = 0;

    for (const hint of pending) {
      try {
        const ack = await params.peerPool.replicateToPeer({
          peerNodeId: params.targetNodeId,
          sourceNodeId: params.sourceNodeId,
          key: hint.key,
          entry: hint.entry,
          operationId: hint.operationId,
          requestId: hint.requestId,
          membership: params.membership
        });

        if (ack.replicaAcked) {
          this.store.removeHint(hint.hintId);
          replayed += 1;
          this.metrics.hintsReplayed += 1;
        } else {
          failed += 1;
          this.metrics.hintsFailed += 1;
          break; // Stop replaying on failure to maintain sequential dependency
        }
      } catch {
        failed += 1;
        this.metrics.hintsFailed += 1;
        break;
      }
    }

    return { replayed, failed };
  }
}
