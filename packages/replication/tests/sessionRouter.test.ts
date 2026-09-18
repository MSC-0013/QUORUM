import { describe, it, expect } from 'vitest';
import { SessionRouter } from '../src/sessionRouter.js';
import { ClientSessionContext, createVersionStamp, toVersionFrontier } from '@quorum-lab/consistency';

describe('SessionRouter & Sticky Replica Affinity (§Q7)', () => {
  it('routes to preferred replica while healthy and available (sticky hit)', () => {
    const router = new SessionRouter('node-1');

    const selected1 = router.selectReplica({
      availableNodeIds: ['node-1', 'node-2', 'node-3']
    });
    expect(selected1).toBe('node-1');

    const selected2 = router.selectReplica({
      availableNodeIds: ['node-1', 'node-2']
    });
    expect(selected2).toBe('node-1');

    const metrics = router.getMetrics();
    expect(metrics.stickyHits).toBe(2);
    expect(metrics.failovers).toBe(0);
  });

  it('fails over to alternate available replica when preferred node is unhealthy', () => {
    const router = new SessionRouter('node-1');

    const healthStatus: Record<string, boolean> = {
      'node-1': false, // Down
      'node-2': true,
      'node-3': true
    };

    const selected = router.selectReplica({
      availableNodeIds: ['node-1', 'node-2', 'node-3'],
      healthChecker: { isNodeHealthy: (id) => Boolean(healthStatus[id]) }
    });

    expect(selected).toBe('node-2');
    expect(router.getPreferredReplica()).toBe('node-2');

    const metrics = router.getMetrics();
    expect(metrics.failovers).toBe(1);
    expect(metrics.stickyHits).toBe(0);
  });

  it('verifies candidate replica satisfies monotonic read frontier during failover', () => {
    const router = new SessionRouter('node-1');
    const session = new ClientSessionContext('sess-failover');

    const v1 = createVersionStamp({
      nodeId: 'node-1',
      counter: 3,
      vectorClock: { 'node-1': 3 },
      lamport: 3,
      wallTimeMs: 1000
    });
    session.recordWrite(v1);

    // Stale candidate node-2 (has not replicated up to counter 3)
    const staleFrontier = toVersionFrontier({
      key: 'test-key',
      entries: [
        {
          value: Buffer.from('old'),
          tombstone: false,
          version: createVersionStamp({
            nodeId: 'node-1',
            counter: 2,
            vectorClock: { 'node-1': 2 },
            lamport: 2,
            wallTimeMs: 900
          })
        }
      ]
    });
    expect(router.verifyMonotonicRead(session, staleFrontier)).toBe(false);

    // Up-to-date candidate node-3
    const upToDateFrontier = toVersionFrontier({
      key: 'test-key',
      entries: [{ value: Buffer.from('curr'), tombstone: false, version: v1 }]
    });
    expect(router.verifyMonotonicRead(session, upToDateFrontier)).toBe(true);
  });
});
