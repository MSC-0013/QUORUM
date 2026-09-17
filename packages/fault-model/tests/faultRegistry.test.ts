import { describe, it, expect } from 'vitest';
import { FaultRegistry, DeterministicRng } from '../src/index.js';

describe('FaultRegistry & Evaluation Logic (§Q4)', () => {
  it('correctly simulates bidirectional network partition between specific nodes', () => {
    const registry = new FaultRegistry();

    // Partition node-a and node-c
    registry.setRule({
      faultId: 'part-ac',
      type: 'PARTITION',
      scope: 'NODE_TO_NODE',
      targetNodeId: 'node-a',
      peerNodeId: 'node-c'
    });

    // Communication node-a -> node-b is allowed
    const decAB = registry.evaluate({
      scope: 'NODE_TO_NODE',
      localNodeId: 'node-a',
      peerNodeId: 'node-b'
    });
    expect(decAB.allow).toBe(true);

    // Communication node-a -> node-c is partitioned (dropped)
    const decAC = registry.evaluate({
      scope: 'NODE_TO_NODE',
      localNodeId: 'node-a',
      peerNodeId: 'node-c'
    });
    expect(decAC.allow).toBe(false);
    expect(decAC.drop).toBe(true);
    expect(decAC.injectError).toContain('NETWORK_PARTITION');
  });

  it('correctly applies delay fault', () => {
    const registry = new FaultRegistry();

    registry.setRule({
      faultId: 'delay-b',
      type: 'DELAY',
      scope: 'NODE_TO_NODE',
      targetNodeId: 'node-a',
      peerNodeId: 'node-b',
      delayMs: 150
    });

    const dec = registry.evaluate({
      scope: 'NODE_TO_NODE',
      localNodeId: 'node-a',
      peerNodeId: 'node-b'
    });
    expect(dec.allow).toBe(true);
    expect(dec.delayMs).toBe(150);
  });

  it('correctly tracks clock skew fault', () => {
    const registry = new FaultRegistry();
    expect(registry.getActiveClockSkewMs('node-a')).toBe(0);

    registry.setRule({
      faultId: 'skew-a',
      type: 'CLOCK_SKEW',
      scope: 'CLOCK',
      targetNodeId: 'node-a',
      clockSkewMs: -5000 // 5 seconds in the past
    });

    expect(registry.getActiveClockSkewMs('node-a')).toBe(-5000);
    expect(registry.getActiveClockSkewMs('node-b')).toBe(0); // isolated to node-a
  });

  it('clears rules and resets registry', () => {
    const registry = new FaultRegistry();
    registry.setRule({
      faultId: 'f1',
      type: 'PARTITION',
      scope: 'NODE_TO_NODE',
      targetNodeId: 'node-a'
    });
    registry.setRule({
      faultId: 'f2',
      type: 'DELAY',
      scope: 'NODE_TO_NODE',
      delayMs: 200
    });

    expect(registry.getActiveRules()).toHaveLength(2);
    expect(registry.clearRule('f1')).toBe(true);
    expect(registry.getActiveRules()).toHaveLength(1);

    expect(registry.clearAll()).toBe(1);
    expect(registry.getActiveRules()).toHaveLength(0);
  });
});
