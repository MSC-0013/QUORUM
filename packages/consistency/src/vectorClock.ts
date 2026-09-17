export type VectorClock = Readonly<Record<string, number>>;

export type VectorClockComparison = 'LESS' | 'GREATER' | 'EQUAL' | 'CONCURRENT';

/**
 * Compares two vector clocks according to the standard happens-before partial order.
 *
 * - 'EQUAL': for all k, a[k] == b[k]
 * - 'GREATER': for all k, a[k] >= b[k], and exists k such that a[k] > b[k] (a dominates b)
 * - 'LESS': for all k, a[k] <= b[k], and exists k such that a[k] < b[k] (b dominates a)
 * - 'CONCURRENT': neither dominates the other (concurrent / incomparable)
 */
export function compareVectorClocks(a: VectorClock, b: VectorClock): VectorClockComparison {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  let aHasGreater = false;
  let bHasGreater = false;

  for (const key of allKeys) {
    const valA = a[key] ?? 0;
    const valB = b[key] ?? 0;

    if (valA > valB) {
      aHasGreater = true;
    } else if (valB > valA) {
      bHasGreater = true;
    }

    if (aHasGreater && bHasGreater) {
      return 'CONCURRENT';
    }
  }

  if (aHasGreater) return 'GREATER';
  if (bHasGreater) return 'LESS';
  return 'EQUAL';
}

/**
 * Returns a new vector clock with nodeId incremented by 1.
 */
export function incrementVectorClock(vc: VectorClock, nodeId: string): Record<string, number> {
  const current = vc[nodeId] ?? 0;
  return {
    ...vc,
    [nodeId]: current + 1
  };
}

/**
 * Merges two vector clocks by computing the pointwise maximum for every known node.
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): Record<string, number> {
  const merged: Record<string, number> = { ...a };
  for (const [nodeId, count] of Object.entries(b)) {
    merged[nodeId] = Math.max(merged[nodeId] ?? 0, count);
  }
  return merged;
}
