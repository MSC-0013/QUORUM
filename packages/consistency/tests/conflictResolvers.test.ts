import { describe, it, expect } from 'vitest';
import {
  VersionedEntry,
  createVersionStamp,
  LwwConflictResolver,
  MultiValueConflictResolver,
  CustomMergeConflictResolver,
  setUnionMerge,
  pnCounterMerge,
  verifyAlgebraicProperties
} from '../src/index.js';

describe('Conflict Resolution Strategies (§Q5)', () => {
  const e1: VersionedEntry = {
    value: Buffer.from('value-node-1'),
    tombstone: false,
    version: createVersionStamp({
      nodeId: 'node-1',
      counter: 2,
      vectorClock: { 'node-1': 2 },
      lamport: 5,
      wallTimeMs: 1000
    })
  };

  const e2: VersionedEntry = {
    value: Buffer.from('value-node-2'),
    tombstone: false,
    version: createVersionStamp({
      nodeId: 'node-2',
      counter: 1,
      vectorClock: { 'node-2': 1 },
      lamport: 4,
      wallTimeMs: 1200 // higher wall time
    })
  };

  it('LWW projects single winner based on highest wall time', () => {
    const resolver = new LwwConflictResolver();
    const resolved = resolver.resolve([e1, e2]) as VersionedEntry;
    expect(resolved).toBeDefined();
    expect(Buffer.from(resolved.value as Uint8Array).toString()).toBe('value-node-2');
  });

  it('MultiValue retains all concurrent siblings', () => {
    const resolver = new MultiValueConflictResolver();
    const resolved = resolver.resolve([e1, e2]) as readonly VersionedEntry[];
    expect(resolved).toHaveLength(2);
    expect(resolved).toContain(e1);
    expect(resolved).toContain(e2);
  });

  it('CustomMerge merges concurrent entries and produces a dominating vector clock', () => {
    const resolver = new CustomMergeConflictResolver(
      (values) => Buffer.from(values.map((v) => Buffer.from(v).toString()).join(' + '))
    );

    const merged = resolver.resolve([e1, e2], 'coordinator-node') as VersionedEntry;
    expect(merged).toBeDefined();
    expect(Buffer.from(merged.value as Uint8Array).toString()).toBe('value-node-1 + value-node-2');

    // Vector clock must subsume both parent vector clocks
    expect(merged.version.vectorClock['node-1']).toBe(2);
    expect(merged.version.vectorClock['node-2']).toBe(1);
    expect(merged.version.vectorClock['coordinator-node']).toBeGreaterThanOrEqual(1);
    expect(merged.version.lamport).toBeGreaterThan(Math.max(e1.version.lamport, e2.version.lamport));
  });

  it('verifies algebraic CRDT properties of setUnionMerge', () => {
    const samples = [
      Buffer.from(JSON.stringify(['apple'])),
      Buffer.from(JSON.stringify(['banana'])),
      Buffer.from(JSON.stringify(['apple', 'cherry']))
    ];

    const binaryUnion = (a: Uint8Array, b: Uint8Array) => setUnionMerge([a, b]);
    const result = verifyAlgebraicProperties(binaryUnion, samples);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('verifies algebraic CRDT properties of pnCounterMerge', () => {
    const samples = [
      Buffer.from('10'),
      Buffer.from('-5'),
      Buffer.from('20')
    ];

    const binarySum = (a: Uint8Array, b: Uint8Array) => pnCounterMerge([a, b]);
    // PN-counter delta addition is commutative and associative (though delta addition is not idempotent)
    const result = verifyAlgebraicProperties(binarySum, samples);
    // Commutative and associative should hold
    const nonIdempotentViolations = result.violations.filter((v) => !v.includes('Idempotence'));
    expect(nonIdempotentViolations).toHaveLength(0);
  });
});
