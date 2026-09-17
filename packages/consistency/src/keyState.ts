import {
  VersionStamp,
  versionStampsEqual
} from './versionStamp.js';
import {
  compareVectorClocks
} from './vectorClock.js';

export interface VersionedEntry {
  readonly value: Uint8Array | null;
  readonly tombstone: boolean;
  readonly version: VersionStamp;
}

/**
 * The canonical stored representation of a key — always a set, even when it holds one entry.
 * Invariant: entries always holds exactly the maximal/undominated versions — a dominated
 * version is removed from `entries` the moment domination is detected (on write or replicate),
 * never retained here. 1 entry = no open conflict; >1 = concurrent/unresolved siblings.
 */
export interface KeyState {
  readonly key: string;
  readonly entries: readonly VersionedEntry[];
}

/**
 * Checks if entry `a` strictly dominates entry `b` in the partial causal order.
 */
export function entryDominates(a: VersionedEntry, b: VersionedEntry): boolean {
  // 1. Check vector clock happens-before
  const vcComp = compareVectorClocks(a.version.vectorClock, b.version.vectorClock);
  if (vcComp === 'GREATER') return true;
  if (vcComp === 'LESS') return false;

  // 2. If vector clocks are identical, check logical Lamport clock
  if (vcComp === 'EQUAL') {
    if (a.version.lamport > b.version.lamport) return true;
    if (a.version.lamport < b.version.lamport) return false;

    // 3. If Lamport clocks are also equal, check dot on same node
    if (a.version.dot.nodeId === b.version.dot.nodeId) {
      return a.version.dot.counter > b.version.dot.counter;
    }
  }

  // Concurrent (incomparable)
  return false;
}

/**
 * Applies an incoming entry to an existing KeyState according to the §Q2 canonical apply rule:
 *
 * 1. If incoming.version equals any entries[i].version -> no-op (duplicate)
 * 2. Else if any entries[i] dominates incoming -> no-op (dominated, no regression)
 * 3. Else: remove every entries[i] that incoming dominates
 *    (all remaining, unrelated entries stay — they're concurrent with incoming)
 * 4. Insert incoming into entries
 */
export function applyIncomingEntry(
  existingEntries: readonly VersionedEntry[],
  incoming: VersionedEntry
): readonly VersionedEntry[] {
  // 1. Duplicate check
  for (const existing of existingEntries) {
    if (versionStampsEqual(existing.version, incoming.version)) {
      return existingEntries; // no-op duplicate
    }
  }

  // 2. Dominated check (existing entry dominates incoming)
  for (const existing of existingEntries) {
    if (entryDominates(existing, incoming)) {
      return existingEntries; // no-op dominated
    }
  }

  // 3. Prune all entries that the incoming entry dominates
  const remainingEntries = existingEntries.filter((existing) => !entryDominates(incoming, existing));

  // 4. Append incoming entry (maximal with respect to all remaining)
  return Object.freeze([...remainingEntries, incoming]);
}

/**
 * Creates an initial KeyState for a key.
 */
export function createEmptyKeyState(key: string): KeyState {
  return Object.freeze({
    key,
    entries: Object.freeze([])
  });
}

/**
 * Creates a KeyState with a single entry.
 */
export function createSingleEntryKeyState(
  key: string,
  entry: VersionedEntry
): KeyState {
  return Object.freeze({
    key,
    entries: Object.freeze([entry])
  });
}
