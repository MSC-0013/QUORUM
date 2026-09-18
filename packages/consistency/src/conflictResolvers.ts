import { VersionedEntry } from './keyState.js';
import { VersionStamp, createVersionStamp } from './versionStamp.js';
import { mergeVectorClocks } from './vectorClock.js';

export interface ConflictResolver {
  resolve(entries: readonly VersionedEntry[], localNodeId?: string): VersionedEntry | readonly VersionedEntry[];
}

export interface AlgebraicProperties {
  readonly isCommutative: boolean;
  readonly isAssociative: boolean;
  readonly isIdempotent: boolean;
}

/**
 * Validates whether a binary merge function satisfies the declared algebraic properties.
 */
export function verifyAlgebraicProperties(
  mergeFn: (a: Uint8Array, b: Uint8Array) => Uint8Array,
  samples: readonly Uint8Array[],
  equalityFn?: (a: Uint8Array, b: Uint8Array) => boolean
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  const bytesEqual =
    equalityFn ??
    ((a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]));

  // 1. Commutativity: merge(a, b) === merge(b, a)
  for (let i = 0; i < samples.length; i++) {
    for (let j = 0; j < samples.length; j++) {
      const a = samples[i]!;
      const b = samples[j]!;
      const ab = mergeFn(a, b);
      const ba = mergeFn(b, a);
      if (!bytesEqual(ab, ba)) {
        violations.push(`Commutativity violation between sample ${i} and ${j}`);
      }
    }
  }

  // 2. Associativity: merge(merge(a, b), c) === merge(a, merge(b, c))
  for (let i = 0; i < samples.length; i++) {
    for (let j = 0; j < samples.length; j++) {
      for (let k = 0; k < samples.length; k++) {
        const a = samples[i]!;
        const b = samples[j]!;
        const c = samples[k]!;
        const ab_c = mergeFn(mergeFn(a, b), c);
        const a_bc = mergeFn(a, mergeFn(b, c));
        if (!bytesEqual(ab_c, a_bc)) {
          violations.push(`Associativity violation among samples ${i}, ${j}, ${k}`);
        }
      }
    }
  }

  // 3. Idempotence: merge(a, a) === a
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!;
    const aa = mergeFn(a, a);
    if (!bytesEqual(aa, a)) {
      violations.push(`Idempotence violation on sample ${i}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

/**
 * Last-Write-Wins Resolver:
 * Deterministically projects a single winning entry using (wallTimeMs -> lamport -> nodeId).
 */
export class LwwConflictResolver implements ConflictResolver {
  public resolve(entries: readonly VersionedEntry[]): VersionedEntry | readonly VersionedEntry[] {
    if (entries.length === 0) return [];
    if (entries.length === 1) return entries[0]!;

    let winner = entries[0]!;
    for (let i = 1; i < entries.length; i++) {
      const candidate = entries[i]!;
      if (candidate.version.wallTimeMs > winner.version.wallTimeMs) {
        winner = candidate;
      } else if (candidate.version.wallTimeMs === winner.version.wallTimeMs) {
        if (candidate.version.lamport > winner.version.lamport) {
          winner = candidate;
        } else if (candidate.version.lamport === winner.version.lamport) {
          if (candidate.version.dot.nodeId > winner.version.dot.nodeId) {
            winner = candidate;
          }
        }
      }
    }
    return winner;
  }
}

/**
 * Multi-Value Resolver:
 * Retains and returns all concurrent siblings to the caller.
 */
export class MultiValueConflictResolver implements ConflictResolver {
  public resolve(entries: readonly VersionedEntry[]): readonly VersionedEntry[] {
    return entries;
  }
}

/**
 * Custom Merge Resolver:
 * Merges concurrent entries using a domain-specific merge reducer and creates
 * a synthetic version stamp that dominates all parent vector clocks.
 */
export class CustomMergeConflictResolver implements ConflictResolver {
  public readonly properties: AlgebraicProperties;
  private readonly mergeFn: (values: readonly Uint8Array[]) => Uint8Array;

  constructor(
    mergeFn: (values: readonly Uint8Array[]) => Uint8Array,
    properties: AlgebraicProperties = { isCommutative: true, isAssociative: true, isIdempotent: true }
  ) {
    this.mergeFn = mergeFn;
    this.properties = properties;
  }

  public resolve(
    entries: readonly VersionedEntry[],
    localNodeId = 'merger'
  ): VersionedEntry | readonly VersionedEntry[] {
    if (entries.length === 0) return [];
    if (entries.length === 1) return entries[0]!;

    // Separate tombstones vs active values
    const nonTombstones = entries.filter((e) => !e.tombstone && e.value !== null);
    if (nonTombstones.length === 0) {
      // All entries are tombstones: pick highest version tombstone
      return entries[entries.length - 1]!;
    }

    const values = nonTombstones.map((e) => e.value as Uint8Array);
    const mergedValue = this.mergeFn(values);

    // Merge vector clocks (pointwise maximum)
    let mergedVc: Record<string, number> = {};
    let maxLamport = 0;
    let maxWallTime = 0;
    let maxCounter = 0;

    for (const e of entries) {
      mergedVc = mergeVectorClocks(mergedVc, e.version.vectorClock);
      if (e.version.lamport > maxLamport) maxLamport = e.version.lamport;
      if (e.version.wallTimeMs > maxWallTime) maxWallTime = e.version.wallTimeMs;
      if (e.version.dot.nodeId === localNodeId && e.version.dot.counter > maxCounter) {
        maxCounter = e.version.dot.counter;
      }
    }

    // Increment local dot to dominate all parent vector clocks
    mergedVc[localNodeId] = (mergedVc[localNodeId] ?? maxCounter) + 1;

    const mergedVersion: VersionStamp = createVersionStamp({
      nodeId: localNodeId,
      counter: mergedVc[localNodeId]!,
      vectorClock: mergedVc,
      lamport: maxLamport + 1,
      wallTimeMs: Math.max(Date.now(), maxWallTime)
    });

    return {
      value: mergedValue,
      tombstone: false,
      version: mergedVersion
    };
  }
}

/**
 * Pre-built CRDT: Set-Union Merge
 * Assumes values are JSON-encoded string arrays or comma-delimited strings.
 */
export function setUnionMerge(values: readonly Uint8Array[]): Uint8Array {
  const set = new Set<string>();
  for (const val of values) {
    try {
      const parsed = JSON.parse(Buffer.from(val).toString('utf8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) set.add(String(item));
        continue;
      }
    } catch {
      // Fallback: parse as comma-separated or plain text
    }
    const raw = Buffer.from(val).toString('utf8').trim();
    if (raw.length > 0) {
      for (const item of raw.split(',')) {
        set.add(item.trim());
      }
    }
  }

  const sortedElements = Array.from(set).sort();
  return Buffer.from(JSON.stringify(sortedElements), 'utf8');
}

/**
 * Pre-built CRDT: PN-Counter Delta Merge
 * Assumes values are JSON or ASCII numbers.
 */
export function pnCounterMerge(values: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const val of values) {
    try {
      const num = Number(Buffer.from(val).toString('utf8'));
      if (!isNaN(num)) {
        total += num;
      }
    } catch {
      // ignore unparseable
    }
  }
  return Buffer.from(String(total), 'utf8');
}
