import { describe, it, expect } from 'vitest';
import {
  VersionedEntry,
  createVersionStamp,
  applyIncomingEntry,
  createEmptyKeyState,
  toVersionFrontier
} from '../src/index.js';

function makeEntry(params: {
  nodeId: string;
  counter: number;
  vc: Record<string, number>;
  lamport: number;
  val: string;
  tombstone?: boolean;
}): VersionedEntry {
  return {
    value: params.val ? Buffer.from(params.val) : null,
    tombstone: params.tombstone ?? false,
    version: createVersionStamp({
      nodeId: params.nodeId,
      counter: params.counter,
      vectorClock: params.vc,
      lamport: params.lamport,
      wallTimeMs: 1000
    })
  };
}

describe('Consistency: KeyState and Canonical Apply Invariants (§6, §Q2)', () => {
  it('adds an initial entry to an empty KeyState', () => {
    const e1 = makeEntry({
      nodeId: 'node-a',
      counter: 1,
      vc: { 'node-a': 1 },
      lamport: 1,
      val: 'v1'
    });

    const entries = applyIncomingEntry([], e1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.value?.toString()).toBe('v1');
  });

  it('no-ops on duplicate VersionStamp (rule 1)', () => {
    const e1 = makeEntry({
      nodeId: 'node-a',
      counter: 1,
      vc: { 'node-a': 1 },
      lamport: 1,
      val: 'v1'
    });

    const entries1 = applyIncomingEntry([], e1);
    // Apply exact same entry again
    const entries2 = applyIncomingEntry(entries1, e1);

    expect(entries2).toHaveLength(1);
    expect(entries2).toBe(entries1); // reference equality / no allocation
  });

  it('no-ops when existing entry dominates incoming (rule 2: no regression)', () => {
    const older = makeEntry({
      nodeId: 'node-a',
      counter: 1,
      vc: { 'node-a': 1 },
      lamport: 1,
      val: 'older'
    });
    const newer = makeEntry({
      nodeId: 'node-a',
      counter: 2,
      vc: { 'node-a': 2 },
      lamport: 2,
      val: 'newer'
    });

    // Start with newer
    const state = applyIncomingEntry([], newer);
    expect(state).toHaveLength(1);
    expect(state[0]?.value?.toString()).toBe('newer');

    // Older arrives late
    const afterLateOlder = applyIncomingEntry(state, older);
    expect(afterLateOlder).toHaveLength(1);
    expect(afterLateOlder[0]?.value?.toString()).toBe('newer'); // never regressed!
  });

  it('prunes existing dominated entries when incoming dominates (rule 3)', () => {
    const e1 = makeEntry({
      nodeId: 'node-a',
      counter: 1,
      vc: { 'node-a': 1 },
      lamport: 1,
      val: 'v1'
    });
    const e2 = makeEntry({
      nodeId: 'node-a',
      counter: 2,
      vc: { 'node-a': 2 },
      lamport: 2,
      val: 'v2'
    });

    const state1 = applyIncomingEntry([], e1);
    const state2 = applyIncomingEntry(state1, e2);

    expect(state2).toHaveLength(1);
    expect(state2[0]?.value?.toString()).toBe('v2');
  });

  it('retains concurrent entries in KeyState.entries (rule 4)', () => {
    // Two concurrent entries from node-a and node-b
    const ea = makeEntry({
      nodeId: 'node-a',
      counter: 1,
      vc: { 'node-a': 1, 'node-b': 0 },
      lamport: 1,
      val: 'valA'
    });
    const eb = makeEntry({
      nodeId: 'node-b',
      counter: 1,
      vc: { 'node-a': 0, 'node-b': 1 },
      lamport: 1,
      val: 'valB'
    });

    const stateA = applyIncomingEntry([], ea);
    const stateBoth = applyIncomingEntry(stateA, eb);

    expect(stateBoth).toHaveLength(2);
    const values = stateBoth.map((e) => e.value?.toString()).sort();
    expect(values).toEqual(['valA', 'valB']);
  });

  it('collapses multiple concurrent entries when a new entry dominates all of them', () => {
    const ea = makeEntry({
      nodeId: 'node-a',
      counter: 1,
      vc: { 'node-a': 1, 'node-b': 0 },
      lamport: 1,
      val: 'valA'
    });
    const eb = makeEntry({
      nodeId: 'node-b',
      counter: 1,
      vc: { 'node-a': 0, 'node-b': 1 },
      lamport: 1,
      val: 'valB'
    });

    const stateBoth = applyIncomingEntry(applyIncomingEntry([], ea), eb);
    expect(stateBoth).toHaveLength(2);

    // Merge/dominating write that observed both: { 'node-a': 1, 'node-b': 1, 'node-c': 1 }
    const merged = makeEntry({
      nodeId: 'node-c',
      counter: 1,
      vc: { 'node-a': 1, 'node-b': 1, 'node-c': 1 },
      lamport: 2,
      val: 'mergedVal'
    });

    const stateCollapsed = applyIncomingEntry(stateBoth, merged);
    expect(stateCollapsed).toHaveLength(1);
    expect(stateCollapsed[0]?.value?.toString()).toBe('mergedVal');
  });

  it('projects VersionFrontier strictly from KeyState.entries', () => {
    const e1 = makeEntry({
      nodeId: 'node-a',
      counter: 1,
      vc: { 'node-a': 1 },
      lamport: 1,
      val: 'v1'
    });

    const state = {
      key: 'my-key',
      entries: [e1]
    };

    const frontier = toVersionFrontier(state);
    expect(frontier.maximalVersions).toHaveLength(1);
    expect(frontier.maximalVersions[0]?.dot.nodeId).toBe('node-a');
    expect(frontier.maximalVersions[0]?.dot.counter).toBe(1);
  });
});
