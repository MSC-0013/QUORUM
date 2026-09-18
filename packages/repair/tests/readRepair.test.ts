import { describe, it, expect } from 'vitest';
import {
  detectStaleReplicas,
  ReadRepairCoordinator,
  ReplicaReadResult
} from '../src/readRepair.js';
import { createVersionStamp, VersionedEntry } from '@quorum-lab/consistency';

describe('Read Repair (§Q6)', () => {
  const versionV1 = createVersionStamp({
    nodeId: 'node-a',
    counter: 1,
    vectorClock: { 'node-a': 1 },
    lamport: 1,
    wallTimeMs: 1000
  });

  const versionV2 = createVersionStamp({
    nodeId: 'node-a',
    counter: 2,
    vectorClock: { 'node-a': 2 },
    lamport: 2,
    wallTimeMs: 2000
  });

  const entryV1: VersionedEntry = {
    value: Buffer.from('value-v1'),
    tombstone: false,
    version: versionV1
  };

  const entryV2: VersionedEntry = {
    value: Buffer.from('value-v2'),
    tombstone: false,
    version: versionV2
  };

  it('identifies replicas that returned dominated versions or empty responses', () => {
    const responses: ReplicaReadResult[] = [
      { nodeId: 'node-1', entries: [entryV2] }, // Up to date
      { nodeId: 'node-2', entries: [entryV1] }, // Stale (dominated)
      { nodeId: 'node-3', entries: [] }        // Missing key entirely
    ];

    const stale = detectStaleReplicas(responses, [entryV2]);
    expect(stale).toEqual(['node-2', 'node-3']);
  });

  it('returns empty array when all replicas are in complete agreement', () => {
    const responses: ReplicaReadResult[] = [
      { nodeId: 'node-1', entries: [entryV2] },
      { nodeId: 'node-2', entries: [entryV2] },
      { nodeId: 'node-3', entries: [entryV2] }
    ];

    const stale = detectStaleReplicas(responses, [entryV2]);
    expect(stale).toEqual([]);
  });

  it('executes background repair dispatch and updates metrics', async () => {
    const coordinator = new ReadRepairCoordinator();

    const dispatched: any[] = [];
    const mockPeerPool: any = {
      replicateToPeer: async (params: any) => {
        dispatched.push(params);
        return { nodeId: params.peerNodeId, replicaAcked: true, durableAcked: true, latencyMs: 2 };
      }
    };

    const membership: any = {
      version: 1,
      members: ['node-1', 'node-2'],
      hash: 'hash1'
    };

    coordinator.executeReadRepairAsync({
      key: 'test-key',
      undominatedEntries: [entryV2],
      staleNodeIds: ['node-2'],
      coordinatorNodeId: 'node-1',
      peerPool: mockPeerPool,
      membership
    });

    // Wait a brief tick for async promise to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].peerNodeId).toBe('node-2');
    expect(dispatched[0].key).toBe('test-key');

    const metrics = coordinator.getMetrics();
    expect(metrics.repairsTriggered).toBe(1);
    expect(metrics.repairsSucceeded).toBe(1);
    expect(metrics.repairsFailed).toBe(0);
  });
});
