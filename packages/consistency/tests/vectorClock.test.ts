import { describe, it, expect } from 'vitest';
import {
  compareVectorClocks,
  incrementVectorClock,
  mergeVectorClocks
} from '../src/index.js';

describe('Consistency: Vector Clock Partial Ordering', () => {
  it('correctly detects EQUAL vector clocks', () => {
    const vc1 = { 'node-a': 2, 'node-b': 3 };
    const vc2 = { 'node-a': 2, 'node-b': 3 };
    expect(compareVectorClocks(vc1, vc2)).toBe('EQUAL');
  });

  it('correctly detects GREATER when one dominates', () => {
    const vc1 = { 'node-a': 3, 'node-b': 3 };
    const vc2 = { 'node-a': 2, 'node-b': 3 };
    expect(compareVectorClocks(vc1, vc2)).toBe('GREATER');
  });

  it('correctly detects LESS when dominated', () => {
    const vc1 = { 'node-a': 1, 'node-b': 2 };
    const vc2 = { 'node-a': 2, 'node-b': 2 };
    expect(compareVectorClocks(vc1, vc2)).toBe('LESS');
  });

  it('correctly detects CONCURRENT when neither dominates (branching history)', () => {
    const vc1 = { 'node-a': 2, 'node-b': 1 };
    const vc2 = { 'node-a': 1, 'node-b': 2 };
    expect(compareVectorClocks(vc1, vc2)).toBe('CONCURRENT');
  });

  it('handles missing keys as zero', () => {
    const vc1 = { 'node-a': 1 };
    const vc2 = { 'node-b': 1 };
    expect(compareVectorClocks(vc1, vc2)).toBe('CONCURRENT');

    const vc3 = { 'node-a': 1, 'node-b': 1 };
    expect(compareVectorClocks(vc3, vc1)).toBe('GREATER');
    expect(compareVectorClocks(vc1, vc3)).toBe('LESS');
  });

  it('increments vector clock for a node', () => {
    const vc = { 'node-a': 1 };
    const incA = incrementVectorClock(vc, 'node-a');
    expect(incA).toEqual({ 'node-a': 2 });

    const incB = incrementVectorClock(vc, 'node-b');
    expect(incB).toEqual({ 'node-a': 1, 'node-b': 1 });
  });

  it('merges vector clocks via pointwise maximum', () => {
    const vc1 = { 'node-a': 5, 'node-b': 2 };
    const vc2 = { 'node-a': 3, 'node-b': 7, 'node-c': 1 };

    const merged = mergeVectorClocks(vc1, vc2);
    expect(merged).toEqual({
      'node-a': 5,
      'node-b': 7,
      'node-c': 1
    });
  });
});
