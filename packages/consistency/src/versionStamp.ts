export interface Dot {
  readonly nodeId: string;
  readonly counter: number;
}

export interface VersionStamp {
  readonly dot: Dot;
  readonly vectorClock: Readonly<Record<string, number>>;
  readonly lamport: number;
  readonly wallTimeMs: number;
}

export function createVersionStamp(params: {
  nodeId: string;
  counter: number;
  vectorClock: Record<string, number>;
  lamport: number;
  wallTimeMs: number;
}): VersionStamp {
  return Object.freeze({
    dot: Object.freeze({
      nodeId: params.nodeId,
      counter: params.counter
    }),
    vectorClock: Object.freeze({ ...params.vectorClock }),
    lamport: params.lamport,
    wallTimeMs: params.wallTimeMs
  });
}

export function versionStampsEqual(a: VersionStamp, b: VersionStamp): boolean {
  if (a.dot.nodeId !== b.dot.nodeId || a.dot.counter !== b.dot.counter) {
    return false;
  }
  if (a.lamport !== b.lamport || a.wallTimeMs !== b.wallTimeMs) {
    return false;
  }
  const keysA = Object.keys(a.vectorClock);
  const keysB = Object.keys(b.vectorClock);
  const allKeys = new Set([...keysA, ...keysB]);
  for (const k of allKeys) {
    const valA = a.vectorClock[k] ?? 0;
    const valB = b.vectorClock[k] ?? 0;
    if (valA !== valB) return false;
  }
  return true;
}
