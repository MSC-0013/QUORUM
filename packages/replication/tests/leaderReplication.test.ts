import { describe, it, expect, vi } from 'vitest';
import {
  FencingCoordinator,
  LeaderReplicationEngine,
  NotLeaderError,
  UnsafeLeaderError,
  FencingViolationError
} from '../src/leaderReplicationEngine.js';
import { PeerClientPool } from '../src/peerClient.js';
import { MembershipSnapshot } from '@quorum-lab/contracts';
import { createVersionStamp, toVersionFrontier } from '@quorum-lab/consistency';

describe('Leader Replication & Fencing (§Q8)', () => {
  it('FencingCoordinator manages epochs, leadership, leases, and step-downs', () => {
    const fc = new FencingCoordinator({ initialEpoch: 1, initialLeaderId: 'node-1', leaseDurationMs: 1000 });

    expect(fc.getEpoch()).toBe(1);
    expect(fc.getLeaderId()).toBe('node-1');
    expect(fc.isLeader('node-1')).toBe(true);
    expect(fc.isLeader('node-2')).toBe(false);
    expect(fc.isLeaseValid()).toBe(true);

    // Lease expires when simulated past lease duration
    const futureTime = Date.now() + 2000;
    expect(fc.isLeaseValid(futureTime)).toBe(false);

    // Renew lease
    fc.renewLease(5000);
    expect(fc.isLeaseValid(Date.now() + 3000)).toBe(true);

    // New leader acquisition increments epoch
    const newEpoch = fc.acquireLeadership('node-2');
    expect(newEpoch).toBe(2);
    expect(fc.getEpoch()).toBe(2);
    expect(fc.getLeaderId()).toBe('node-2');
    expect(fc.isLeader('node-2')).toBe(true);
    expect(fc.isLeader('node-1')).toBe(false);

    // Fencing check: older epoch rejected, newer epoch accepted
    expect(fc.verifyFencingEpoch(1).valid).toBe(false);
    expect(fc.verifyFencingEpoch(2).valid).toBe(true);
    expect(fc.verifyFencingEpoch(3).valid).toBe(true);

    // Stepping down
    fc.stepDown('node-3');
    expect(fc.isLeader('node-2')).toBe(false);
    expect(fc.getLeaderId()).toBe('node-3');
    expect(fc.isLeaseValid()).toBe(false);
  });

  it('LeaderReplicationEngine rejects mutations when called on a non-leader replica', async () => {
    const fc = new FencingCoordinator({ initialEpoch: 1, initialLeaderId: 'node-leader' });
    const localOps = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      isDurable: vi.fn().mockReturnValue(true)
    };
    const peerPool = new PeerClientPool();
    const getMembership = (): MembershipSnapshot => ({ version: 1, members: ['node-follower', 'node-leader'], hash: 'hash1' });

    const engine = new LeaderReplicationEngine({
      localNodeId: 'node-follower',
      localOps,
      peerPool,
      getMembership,
      fencingCoordinator: fc
    });

    await expect(
      engine.put({
        key: 'test-k',
        value: Buffer.from('val'),
        runId: 'r1',
        clientId: 'c1',
        requestId: 'req1',
        operationId: 'op1'
      })
    ).rejects.toThrow(NotLeaderError);

    await expect(
      engine.delete({
        key: 'test-k',
        runId: 'r1',
        clientId: 'c1',
        requestId: 'req1',
        operationId: 'op1'
      })
    ).rejects.toThrow(NotLeaderError);
  });

  it('LeaderReplicationEngine rejects mutations when leader lease has expired', async () => {
    const fc = new FencingCoordinator({ initialEpoch: 1, initialLeaderId: 'node-leader', leaseDurationMs: -100 }); // expired lease
    const localOps = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      isDurable: vi.fn().mockReturnValue(true)
    };
    const peerPool = new PeerClientPool();
    const getMembership = (): MembershipSnapshot => ({ version: 1, members: ['node-leader'], hash: 'hash1' });

    const engine = new LeaderReplicationEngine({
      localNodeId: 'node-leader',
      localOps,
      peerPool,
      getMembership,
      fencingCoordinator: fc
    });

    await expect(
      engine.put({
        key: 'test-k',
        value: Buffer.from('val'),
        runId: 'r1',
        clientId: 'c1',
        requestId: 'req1',
        operationId: 'op1'
      })
    ).rejects.toThrow(UnsafeLeaderError);
  });

  it('LeaderReplicationEngine executes put and replicates with fencing epoch to followers', async () => {
    const fc = new FencingCoordinator({ initialEpoch: 5, initialLeaderId: 'node-leader', leaseDurationMs: 10000 });
    const version = createVersionStamp({
      nodeId: 'node-leader',
      counter: 1,
      lamport: 1,
      wallTimeMs: 1000,
      vectorClock: { 'node-leader': 1 }
    });
    const frontier = toVersionFrontier({
      key: 'k1',
      entries: [{ value: Buffer.from('v1'), tombstone: false, version }]
    });

    const localOps = {
      put: vi.fn().mockResolvedValue({ version, frontier, isDuplicate: false }),
      get: vi.fn(),
      delete: vi.fn(),
      isDurable: vi.fn().mockReturnValue(true)
    };

    const peerPool = new PeerClientPool();
    vi.spyOn(peerPool, 'replicateToPeer').mockResolvedValue({
      nodeId: 'node-follower',
      replicaAcked: true,
      durableAcked: true,
      latencyMs: 1.5
    });

    const getMembership = (): MembershipSnapshot => ({
      version: 1,
      members: ['node-leader', 'node-follower'],
      hash: 'hash1'
    });

    const engine = new LeaderReplicationEngine({
      localNodeId: 'node-leader',
      localOps,
      peerPool,
      getMembership,
      fencingCoordinator: fc,
      quorumConfig: { W: 2, R: 1 }
    });

    const result = await engine.put({
      key: 'k1',
      value: Buffer.from('v1'),
      runId: 'r1',
      clientId: 'c1',
      requestId: 'req1',
      operationId: 'op1'
    });

    expect(result.totalReplicaAcks).toBe(2);
    expect(result.totalDurableAcks).toBe(2);
    expect(peerPool.replicateToPeer).toHaveBeenCalledWith(
      expect.objectContaining({
        fencingEpoch: 5,
        peerNodeId: 'node-follower'
      })
    );
  });
});
