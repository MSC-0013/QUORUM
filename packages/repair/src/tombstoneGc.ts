import { VersionStamp, KeyState, VersionedEntry } from '@quorum-lab/consistency';
import { MembershipSnapshot } from '@quorum-lab/contracts';

export interface ReplicaObservedFrontier {
  readonly dotCounters?: Record<string, number>;
  readonly minWitnessedLamport?: number;
}

export interface TombstoneGcEvaluationParams {
  readonly tombstoneVersion: VersionStamp;
  readonly membership: MembershipSnapshot;
  readonly replicaFrontiers: ReadonlyMap<string, ReplicaObservedFrontier>;
  readonly gcSafetyWindowMs?: number;
  readonly nowMs?: number;
}

/**
 * Evaluates whether a tombstone can safely be removed from storage without risking resurrection.
 * Invariant: All cluster members in membership must have witnessed past the tombstone's dot or Lamport clock.
 */
export function canSafelyCollectTombstone(params: TombstoneGcEvaluationParams): boolean {
  const { tombstoneVersion, membership, replicaFrontiers, gcSafetyWindowMs, nowMs } = params;

  // 1. Check optional grace period safety window
  if (gcSafetyWindowMs && gcSafetyWindowMs > 0) {
    const current = nowMs ?? Date.now();
    if (current - tombstoneVersion.wallTimeMs < gcSafetyWindowMs) {
      return false; // Still within safety grace window
    }
  }

  // 2. All active cluster members must have a registered frontier
  for (const memberId of membership.members) {
    const frontier = replicaFrontiers.get(memberId);
    if (!frontier) {
      // Offline or unobserved cluster member: cannot safely collect
      return false;
    }

    const tombstoneNodeId = tombstoneVersion.dot.nodeId;
    const tombstoneCounter = Number(tombstoneVersion.dot.counter);
    const tombstoneLamport = Number(tombstoneVersion.lamport);

    const witnessedDotCounter = Number(frontier.dotCounters?.[tombstoneNodeId] ?? 0);
    const witnessedLamport = Number(frontier.minWitnessedLamport ?? 0);

    const witnessedPastDot = witnessedDotCounter >= tombstoneCounter;
    const witnessedPastLamport = witnessedLamport >= tombstoneLamport;

    if (!witnessedPastDot && !witnessedPastLamport) {
      // Member has not yet certified witnessing this tombstone
      return false;
    }
  }

  return true;
}

export interface TombstoneGcSweepResult {
  readonly evaluatedTombstones: number;
  readonly prunedEntries: number;
  readonly purgedKeys: readonly string[];
}

export interface GcTargetStore {
  getAllKeys(): string[];
  get(key: string): KeyState;
  set(keyState: KeyState): void;
  deleteKey(key: string): void;
}

/**
 * Sweeps the provided store and prunes tombstones that meet safety certificates.
 */
export function sweepTombstones(
  store: GcTargetStore,
  params: {
    membership: MembershipSnapshot;
    replicaFrontiers: ReadonlyMap<string, ReplicaObservedFrontier>;
    gcSafetyWindowMs?: number;
    nowMs?: number;
  }
): TombstoneGcSweepResult {
  const keys = store.getAllKeys();
  let evaluated = 0;
  let pruned = 0;
  const purgedKeys: string[] = [];

  for (const key of keys) {
    const keyState = store.get(key);
    if (!keyState || keyState.entries.length === 0) continue;

    const remainingEntries: VersionedEntry[] = [];
    let stateChanged = false;

    for (const entry of keyState.entries) {
      if (!entry.tombstone) {
        remainingEntries.push(entry);
        continue;
      }

      evaluated += 1;
      const safe = canSafelyCollectTombstone({
        tombstoneVersion: entry.version,
        membership: params.membership,
        replicaFrontiers: params.replicaFrontiers,
        gcSafetyWindowMs: params.gcSafetyWindowMs,
        nowMs: params.nowMs
      });

      if (safe) {
        pruned += 1;
        stateChanged = true;
      } else {
        remainingEntries.push(entry);
      }
    }

    if (stateChanged) {
      if (remainingEntries.length === 0) {
        store.deleteKey(key);
        purgedKeys.push(key);
      } else {
        store.set({
          key,
          entries: Object.freeze(remainingEntries)
        });
      }
    }
  }

  return {
    evaluatedTombstones: evaluated,
    prunedEntries: pruned,
    purgedKeys: Object.freeze(purgedKeys)
  };
}
