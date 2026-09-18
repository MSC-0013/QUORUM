import { describe, it, expect } from 'vitest';
import {
  HintedHandoffManager,
  HintStore
} from '../src/hintedHandoff.js';
import { createVersionStamp, VersionedEntry } from '@quorum-lab/consistency';

describe('Hinted Handoff (§Q6)', () => {
  const sampleEntry: VersionedEntry = {
    value: Buffer.from('hint-value-1'),
    tombstone: false,
    version: createVersionStamp({
      nodeId: 'node-coord',
      counter: 1,
      vectorClock: { 'node-coord': 1 },
      lamport: 1,
      wallTimeMs: 1000
    })
  };

  it('records hints for unreachable target peers', async () => {
    const manager = new HintedHandoffManager();

    const hint = await manager.storeHint({
      targetNodeId: 'node-down',
      key: 'key-1',
      entry: sampleEntry,
      operationId: 'op-1',
      requestId: 'req-1'
    });

    expect(hint.targetNodeId).toBe('node-down');
    expect(hint.key).toBe('key-1');
    expect(manager.getStore().getPendingCount()).toBe(1);

    const metrics = manager.getMetrics();
    expect(metrics.hintsStored).toBe(1);
    expect(metrics.hintsPending).toBe(1);
  });

  it('replays hints in order when peer becomes available and deletes replayed hints', async () => {
    const manager = new HintedHandoffManager();

    await manager.storeHint({
      targetNodeId: 'node-down',
      key: 'key-1',
      entry: sampleEntry,
      operationId: 'op-1',
      requestId: 'req-1'
    });

    await manager.storeHint({
      targetNodeId: 'node-down',
      key: 'key-2',
      entry: sampleEntry,
      operationId: 'op-2',
      requestId: 'req-2'
    });

    const replayedOps: string[] = [];
    const mockPeerPool: any = {
      replicateToPeer: async (params: any) => {
        replayedOps.push(params.key);
        return { nodeId: params.peerNodeId, replicaAcked: true, durableAcked: true, latencyMs: 1 };
      }
    };

    const membership: any = { version: 1, members: ['node-coord', 'node-down'], hash: 'h' };

    const result = await manager.replayHintsForNode({
      targetNodeId: 'node-down',
      sourceNodeId: 'node-coord',
      peerPool: mockPeerPool,
      membership
    });

    expect(result.replayed).toBe(2);
    expect(result.failed).toBe(0);
    expect(replayedOps).toEqual(['key-1', 'key-2']);
    expect(manager.getStore().getPendingCount()).toBe(0);

    const metrics = manager.getMetrics();
    expect(metrics.hintsReplayed).toBe(2);
    expect(metrics.hintsPending).toBe(0);
  });

  it('halts replay on first failure to preserve sequential ordering', async () => {
    const manager = new HintedHandoffManager();

    await manager.storeHint({
      targetNodeId: 'node-flaky',
      key: 'k-1',
      entry: sampleEntry,
      operationId: 'op-1',
      requestId: 'req-1'
    });

    await manager.storeHint({
      targetNodeId: 'node-flaky',
      key: 'k-2',
      entry: sampleEntry,
      operationId: 'op-2',
      requestId: 'req-2'
    });

    let callCount = 0;
    const mockPeerPool: any = {
      replicateToPeer: async () => {
        callCount++;
        // First call fails
        return { nodeId: 'node-flaky', replicaAcked: false, durableAcked: false, latencyMs: 1, error: 'connection refused' };
      }
    };

    const membership: any = { version: 1, members: ['node-coord', 'node-flaky'], hash: 'h' };

    const result = await manager.replayHintsForNode({
      targetNodeId: 'node-flaky',
      sourceNodeId: 'node-coord',
      peerPool: mockPeerPool,
      membership
    });

    expect(result.replayed).toBe(0);
    expect(result.failed).toBe(1);
    expect(callCount).toBe(1); // Second hint was NOT attempted
    expect(manager.getStore().getPendingCount()).toBe(2); // Retained
  });
});
