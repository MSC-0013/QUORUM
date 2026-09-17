import { describe, it, expect, beforeEach } from 'vitest';
import { MemStore } from '../../src/engine/memStore.js';
import { createVersionStamp } from '@quorum-lab/consistency';

describe('QuorumNode: MemStore Unit Tests', () => {
  let store: MemStore;

  beforeEach(() => {
    store = new MemStore();
  });

  it('stores and retrieves a key', () => {
    const v1 = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1 },
      lamport: 1,
      wallTimeMs: 1000
    });

    const { keyState, frontier } = store.put('user:100', Buffer.from('Alice'), v1);

    expect(keyState.key).toBe('user:100');
    expect(keyState.entries).toHaveLength(1);
    expect(keyState.entries[0]?.value?.toString()).toBe('Alice');
    expect(keyState.entries[0]?.tombstone).toBe(false);
    expect(frontier.maximalVersions).toHaveLength(1);

    const retrieved = store.get('user:100');
    expect(retrieved.entries).toHaveLength(1);
    expect(retrieved.entries[0]?.value?.toString()).toBe('Alice');
    expect(store.hasActiveKey('user:100')).toBe(true);
  });

  it('marks key deleted with tombstone VersionedEntry', () => {
    const v1 = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1 },
      lamport: 1,
      wallTimeMs: 1000
    });
    store.put('user:100', Buffer.from('Alice'), v1);

    const v2 = createVersionStamp({
      nodeId: 'node-a',
      counter: 2,
      vectorClock: { 'node-a': 2 },
      lamport: 2,
      wallTimeMs: 1050
    });
    const { keyState } = store.delete('user:100', v2);

    expect(keyState.entries).toHaveLength(1);
    expect(keyState.entries[0]?.tombstone).toBe(true);
    expect(keyState.entries[0]?.value).toBeNull();
    expect(store.hasActiveKey('user:100')).toBe(false);
  });

  it('computes accurate storage metrics', () => {
    const v1 = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1 },
      lamport: 1,
      wallTimeMs: 1000
    });
    const v2 = createVersionStamp({
      nodeId: 'node-a',
      counter: 2,
      vectorClock: { 'node-a': 2 },
      lamport: 2,
      wallTimeMs: 1010
    });

    store.put('k1', Buffer.from('val1'), v1);
    store.put('k2', Buffer.from('val2'), v2);

    const metricsBefore = store.getMetrics();
    expect(metricsBefore.keyCount).toBe(2);
    expect(metricsBefore.totalEntriesCount).toBe(2);
    expect(metricsBefore.tombstoneCount).toBe(0);

    const v3 = createVersionStamp({
      nodeId: 'node-a',
      counter: 3,
      vectorClock: { 'node-a': 3 },
      lamport: 3,
      wallTimeMs: 1020
    });
    store.delete('k1', v3);

    const metricsAfter = store.getMetrics();
    expect(metricsAfter.keyCount).toBe(2);
    expect(metricsAfter.tombstoneCount).toBe(1);
  });
});
