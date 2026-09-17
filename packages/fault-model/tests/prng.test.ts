import { describe, it, expect } from 'vitest';
import { DeterministicRng, deriveStreamSeed } from '../src/index.js';

describe('Deterministic PRNG & Stream Derivation (§Q4)', () => {
  it('produces identical sequences given the same numerical seed', () => {
    const rng1 = new DeterministicRng(42);
    const rng2 = new DeterministicRng(42);

    const seq1 = Array.from({ length: 10 }, () => rng1.nextFloat());
    const seq2 = Array.from({ length: 10 }, () => rng2.nextFloat());

    expect(seq1).toEqual(seq2);
  });

  it('produces identical sequences given the same root seed string and stream name', () => {
    const seedA = deriveStreamSeed('experiment-alpha', 'network-loss', 'node-1');
    const seedB = deriveStreamSeed('experiment-alpha', 'network-loss', 'node-1');
    expect(seedA).toBe(seedB);

    const rngA = new DeterministicRng(seedA);
    const rngB = new DeterministicRng(seedB);

    for (let i = 0; i < 20; i++) {
      expect(rngA.nextInt(1, 100)).toBe(rngB.nextInt(1, 100));
    }
  });

  it('produces distinct sequences for different stream identities under the same root seed', () => {
    const seed1 = deriveStreamSeed('experiment-alpha', 'network-loss', 'node-1');
    const seed2 = deriveStreamSeed('experiment-alpha', 'network-loss', 'node-2');
    expect(seed1).not.toBe(seed2);

    const rng1 = new DeterministicRng(seed1);
    const rng2 = new DeterministicRng(seed2);

    const seq1 = Array.from({ length: 5 }, () => rng1.nextFloat());
    const seq2 = Array.from({ length: 5 }, () => rng2.nextFloat());

    expect(seq1).not.toEqual(seq2);
  });

  it('samples from Zipfian distribution with higher frequency on lower ranks', () => {
    const rng = new DeterministicRng(999);
    const n = 10;
    const s = 1.5; // High skew

    const counts: Record<number, number> = {};
    const trials = 5000;
    for (let i = 0; i < trials; i++) {
      const rank = rng.sampleZipfian(n, s);
      counts[rank] = (counts[rank] ?? 0) + 1;
    }

    // Rank 1 must have substantially more samples than Rank 10
    expect(counts[1]).toBeGreaterThan(counts[10]! * 3);
    expect(counts[1]! + counts[2]!).toBeGreaterThan(trials * 0.4);
  });
});
