import { describe, it, expect } from 'vitest';
import { resolveQuorumNumbers } from '@quorum-lab/contracts';
import { resolveLwwWinner } from '../src/index.js';
import { createVersionStamp, VersionedEntry } from '@quorum-lab/consistency';

describe('Replication: Quorum Intersection Math Verification (§Q3)', () => {
  it('verifies standard majority quorum calculation (N=3, N=5, N=7)', () => {
    const q3 = resolveQuorumNumbers(3, { mode: 'QUORUM' }, { mode: 'QUORUM' });
    expect(q3.W).toBe(2);
    expect(q3.R).toBe(2);
    expect(q3.hasQuorumIntersection).toBe(true); // 2 + 2 > 3

    const q5 = resolveQuorumNumbers(5, { mode: 'QUORUM' }, { mode: 'QUORUM' });
    expect(q5.W).toBe(3);
    expect(q5.R).toBe(3);
    expect(q5.hasQuorumIntersection).toBe(true); // 3 + 3 > 5

    const q7 = resolveQuorumNumbers(7, { mode: 'QUORUM' }, { mode: 'QUORUM' });
    expect(q7.W).toBe(4);
    expect(q7.R).toBe(4);
    expect(q7.hasQuorumIntersection).toBe(true); // 4 + 4 > 7
  });

  it('proves pigeonhole intersection: any write quorum of size W and read quorum of size R intersect when W + R > N', () => {
    // Test multiple combinations of N, W, R
    for (let N = 3; N <= 7; N++) {
      const allNodes = Array.from({ length: N }, (_, i) => `node-${i}`);

      for (let W = 1; W <= N; W++) {
        for (let R = 1; R <= N; R++) {
          const satisfiesQuorum = W + R > N;

          // Generate combinations of size W and size R
          // Pick a sample of subsets
          const Q_W = new Set(allNodes.slice(0, W));
          const Q_R = new Set(allNodes.slice(N - R, N)); // worst case opposing sides

          const intersection = [...Q_W].filter((node) => Q_R.has(node));

          if (satisfiesQuorum) {
            expect(intersection.length).toBeGreaterThanOrEqual(W + R - N);
            expect(intersection.length).toBeGreaterThanOrEqual(1);
          } else {
            // When W + R <= N, disjoint quorums can exist!
            expect(intersection.length).toBe(0);
          }
        }
      }
    }
  });
});

describe('Replication: LWW Winner Tie-Break Resolution (§Q5, §28)', () => {
  it('picks highest wallTimeMs first', () => {
    const e1: VersionedEntry = {
      value: Buffer.from('v1'),
      tombstone: false,
      version: createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: {}, lamport: 10, wallTimeMs: 1000 })
    };
    const e2: VersionedEntry = {
      value: Buffer.from('v2'),
      tombstone: false,
      version: createVersionStamp({ nodeId: 'node-b', counter: 1, vectorClock: {}, lamport: 5, wallTimeMs: 1500 }) // higher wall time
    };

    const winner = resolveLwwWinner([e1, e2]);
    expect(winner?.value?.toString()).toBe('v2');
  });

  it('breaks tie on lamport if wallTimeMs is identical', () => {
    const e1: VersionedEntry = {
      value: Buffer.from('v1'),
      tombstone: false,
      version: createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: {}, lamport: 10, wallTimeMs: 1000 })
    };
    const e2: VersionedEntry = {
      value: Buffer.from('v2'),
      tombstone: false,
      version: createVersionStamp({ nodeId: 'node-b', counter: 1, vectorClock: {}, lamport: 15, wallTimeMs: 1000 }) // higher lamport
    };

    const winner = resolveLwwWinner([e1, e2]);
    expect(winner?.value?.toString()).toBe('v2');
  });

  it('breaks tie on nodeId if wallTimeMs and lamport are identical', () => {
    const e1: VersionedEntry = {
      value: Buffer.from('v1'),
      tombstone: false,
      version: createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: {}, lamport: 10, wallTimeMs: 1000 })
    };
    const e2: VersionedEntry = {
      value: Buffer.from('v2'),
      tombstone: false,
      version: createVersionStamp({ nodeId: 'node-z', counter: 1, vectorClock: {}, lamport: 10, wallTimeMs: 1000 }) // 'node-z' > 'node-a'
    };

    const winner = resolveLwwWinner([e1, e2]);
    expect(winner?.value?.toString()).toBe('v2');
  });
});
