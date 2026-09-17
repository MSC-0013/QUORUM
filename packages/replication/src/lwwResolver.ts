import { VersionedEntry } from '@quorum-lab/consistency';

/**
 * Resolves a single winning VersionedEntry from a set of concurrent entries
 * using the frozen §Q5 tiebreak order:
 * 1. wallTimeMs (descending)
 * 2. lamport (descending)
 * 3. nodeId (descending lexicographical)
 * 4. dot.counter (descending)
 *
 * Invariant: This is a read-time projection only; it never deletes losing entries from storage.
 */
export function resolveLwwWinner(entries: readonly VersionedEntry[]): VersionedEntry | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]!;

  const sorted = [...entries].sort((a, b) => {
    // 1. Physical wall clock
    if (a.version.wallTimeMs !== b.version.wallTimeMs) {
      return b.version.wallTimeMs - a.version.wallTimeMs;
    }

    // 2. Logical Lamport clock
    if (a.version.lamport !== b.version.lamport) {
      return b.version.lamport - a.version.lamport;
    }

    // 3. Node ID
    if (a.version.dot.nodeId !== b.version.dot.nodeId) {
      return b.version.dot.nodeId.localeCompare(a.version.dot.nodeId);
    }

    // 4. Dot counter
    return b.version.dot.counter - a.version.dot.counter;
  });

  return sorted[0]!;
}
