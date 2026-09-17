import { describe, it, expect } from 'vitest';
import {
  SyncReplicationEngine,
  AsyncReplicationEngine,
  LocalNodeOperations
} from '../src/index.js';
import { createVersionStamp } from '@quorum-lab/consistency';
import { createMembershipSnapshot } from '@quorum-lab/contracts';

describe('Replication: Sync and Async Replication Engines', () => {
  const membership = createMembershipSnapshot(1, ['node-a', 'node-b', 'node-c']);

  it('SyncReplicationEngine replicates locally and fans out to all peers', async () => {
    const replicatedTo: string[] = [];

    const mockLocalOps: LocalNodeOperations = {
      put: async (params) => ({
        version: createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: { 'node-a': 1 }, lamport: 1, wallTimeMs: 1000 }),
        frontier: { maximalVersions: [] },
        isDuplicate: false
      }),
      get: (params) => ({ keyState: { key: params.key, entries: [] }, frontier: { maximalVersions: [] } }),
      delete: async () => ({ tombstoneVersion: null, frontier: { maximalVersions: [] }, isDuplicate: false }),
      isDurable: () => true
    };

    const mockPeerPool: any = {
      replicateToPeer: async (params: any) => {
        replicatedTo.push(params.peerNodeId);
        return {
          nodeId: params.peerNodeId,
          replicaAcked: true,
          durableAcked: true,
          latencyMs: 1.5
        };
      },
      close: async () => {}
    };

    const engine = new SyncReplicationEngine({
      localNodeId: 'node-a',
      localOps: mockLocalOps,
      peerPool: mockPeerPool,
      getMembership: () => membership
    });

    const result = await engine.put({
      key: 'sync-key',
      value: Buffer.from('payload'),
      clientId: 'c1',
      requestId: 'r1',
      operationId: 'op1',
      runId: 'run1'
    });

    expect(result.replicaAcks).toHaveLength(3); // node-a (local) + node-b + node-c
    expect(result.totalReplicaAcks).toBe(3);
    expect(result.totalDurableAcks).toBe(3);
    expect(replicatedTo.sort()).toEqual(['node-b', 'node-c']);
  });

  it('AsyncReplicationEngine writes locally and fires async fanout', async () => {
    let peerReplicatedCount = 0;

    const mockLocalOps: LocalNodeOperations = {
      put: async () => ({
        version: createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: { 'node-a': 1 }, lamport: 1, wallTimeMs: 1000 }),
        frontier: { maximalVersions: [] },
        isDuplicate: false
      }),
      get: () => ({ keyState: { key: '', entries: [] }, frontier: { maximalVersions: [] } }),
      delete: async () => ({ tombstoneVersion: null, frontier: { maximalVersions: [] }, isDuplicate: false }),
      isDurable: () => false
    };

    const mockPeerPool: any = {
      replicateToPeer: async () => {
        peerReplicatedCount++;
        return { nodeId: 'peer', replicaAcked: true, durableAcked: false, latencyMs: 2 };
      },
      close: async () => {}
    };

    const engine = new AsyncReplicationEngine({
      localNodeId: 'node-a',
      localOps: mockLocalOps,
      peerPool: mockPeerPool,
      getMembership: () => membership
    });

    const result = await engine.put({
      key: 'async-key',
      value: Buffer.from('payload'),
      clientId: 'c1',
      requestId: 'r1',
      operationId: 'op1',
      runId: 'run1'
    });

    // Returns immediately after local ACK (totalReplicaAcks = 1)
    expect(result.replicaAcks).toHaveLength(1);
    expect(result.replicaAcks[0]?.nodeId).toBe('node-a');
    expect(result.totalReplicaAcks).toBe(1);

    // Wait short tick for fire-and-forget background promises
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(peerReplicatedCount).toBe(2); // node-b and node-c
  });
});
