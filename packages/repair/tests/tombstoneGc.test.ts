import { describe, it, expect } from 'vitest';
import {
  canSafelyCollectTombstone,
  sweepTombstones,
  GcTargetStore
} from '../src/tombstoneGc.js';
import { createVersionStamp, KeyState } from '@quorum-lab/consistency';

describe('Tombstone Garbage Collection (§Q6)', () => {
  const membership: any = {
    version: 1,
    members: ['node-1', 'node-2', 'node-3'],
    hash: 'mem-hash'
  };

  const tombstoneV1 = createVersionStamp({
    nodeId: 'node-1',
    counter: 5,
    vectorClock: { 'node-1': 5 },
    lamport: 10,
    wallTimeMs: 1000
  });

  it('rejects GC when one or more cluster members have not witnessed the tombstone', () => {
    const frontiers = new Map([
      ['node-1', { dotCounters: { 'node-1': 5 }, minWitnessedLamport: 10 }],
      ['node-2', { dotCounters: { 'node-1': 5 }, minWitnessedLamport: 10 }],
      ['node-3', { dotCounters: { 'node-1': 3 }, minWitnessedLamport: 8 }] // Lagging behind!
    ]);

    const safe = canSafelyCollectTombstone({
      tombstoneVersion: tombstoneV1,
      membership,
      replicaFrontiers: frontiers
    });

    expect(safe).toBe(false);
  });

  it('rejects GC when a cluster member is offline/missing from reported frontiers', () => {
    const frontiers = new Map([
      ['node-1', { dotCounters: { 'node-1': 5 } }],
      ['node-2', { dotCounters: { 'node-1': 5 } }]
      // node-3 is completely missing
    ]);

    const safe = canSafelyCollectTombstone({
      tombstoneVersion: tombstoneV1,
      membership,
      replicaFrontiers: frontiers
    });

    expect(safe).toBe(false);
  });

  it('approves GC when all cluster members have witnessed past the tombstone', () => {
    const frontiers = new Map([
      ['node-1', { dotCounters: { 'node-1': 6 }, minWitnessedLamport: 12 }],
      ['node-2', { dotCounters: { 'node-1': 5 }, minWitnessedLamport: 11 }],
      ['node-3', { dotCounters: { 'node-1': 5 }, minWitnessedLamport: 10 }]
    ]);

    const safe = canSafelyCollectTombstone({
      tombstoneVersion: tombstoneV1,
      membership,
      replicaFrontiers: frontiers
    });

    expect(safe).toBe(true);
  });

  it('respects optional safety grace period window', () => {
    const frontiers = new Map([
      ['node-1', { dotCounters: { 'node-1': 10 } }],
      ['node-2', { dotCounters: { 'node-1': 10 } }],
      ['node-3', { dotCounters: { 'node-1': 10 } }]
    ]);

    // Tombstone created at wallTimeMs = 1000. Now = 1500. Window = 1000ms.
    const notExpired = canSafelyCollectTombstone({
      tombstoneVersion: tombstoneV1,
      membership,
      replicaFrontiers: frontiers,
      gcSafetyWindowMs: 1000,
      nowMs: 1500
    });
    expect(notExpired).toBe(false);

    // Now = 2500. Exceeds 1000ms grace window.
    const expired = canSafelyCollectTombstone({
      tombstoneVersion: tombstoneV1,
      membership,
      replicaFrontiers: frontiers,
      gcSafetyWindowMs: 1000,
      nowMs: 2500
    });
    expect(expired).toBe(true);
  });

  it('sweeps and purges certified tombstones from store while preserving live keys', () => {
    const inMemoryKeys = new Map<string, KeyState>();

    // Live key
    inMemoryKeys.set('live-key', {
      key: 'live-key',
      entries: [
        {
          value: Buffer.from('data'),
          tombstone: false,
          version: tombstoneV1
        }
      ]
    });

    // Certified dead key
    inMemoryKeys.set('dead-key', {
      key: 'dead-key',
      entries: [
        {
          value: null,
          tombstone: true,
          version: tombstoneV1
        }
      ]
    });

    const mockStore: GcTargetStore = {
      getAllKeys: () => Array.from(inMemoryKeys.keys()),
      get: (k) => inMemoryKeys.get(k)!,
      set: (ks) => inMemoryKeys.set(ks.key, ks),
      deleteKey: (k) => inMemoryKeys.delete(k)
    };

    const frontiers = new Map([
      ['node-1', { dotCounters: { 'node-1': 10 } }],
      ['node-2', { dotCounters: { 'node-1': 10 } }],
      ['node-3', { dotCounters: { 'node-1': 10 } }]
    ]);

    const sweepRes = sweepTombstones(mockStore, {
      membership,
      replicaFrontiers: frontiers
    });

    expect(sweepRes.evaluatedTombstones).toBe(1);
    expect(sweepRes.prunedEntries).toBe(1);
    expect(sweepRes.purgedKeys).toEqual(['dead-key']);

    expect(inMemoryKeys.has('live-key')).toBe(true);
    expect(inMemoryKeys.has('dead-key')).toBe(false);
  });
});
