import { describe, it, expect } from 'vitest';
import { ExperimentTimeline, FaultRegistry } from '../src/index.js';

describe('ExperimentTimeline & Scheduled Execution (§Q4)', () => {
  it('automatically expands durationMs into SET_FAULT and CLEAR_FAULT events', () => {
    const timeline = new ExperimentTimeline([
      {
        offsetMs: 500,
        action: 'SET_FAULT',
        durationMs: 1000,
        rule: {
          faultId: 'temp-partition',
          type: 'PARTITION',
          scope: 'NODE_TO_NODE',
          targetNodeId: 'node-a',
          peerNodeId: 'node-b'
        }
      }
    ]);

    const events = timeline.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.offsetMs).toBe(500);
    expect(events[0]?.action).toBe('SET_FAULT');

    expect(events[1]?.offsetMs).toBe(1500); // 500 + 1000
    expect(events[1]?.action).toBe('CLEAR_FAULT');
    expect(events[1]?.faultId).toBe('temp-partition');
  });

  it('applies events strictly up to monotonic offset', () => {
    const registry = new FaultRegistry();
    const timeline = new ExperimentTimeline([
      {
        offsetMs: 200,
        action: 'SET_FAULT',
        rule: {
          faultId: 'f-200',
          type: 'DELAY',
          scope: 'NODE_TO_NODE',
          delayMs: 100
        }
      },
      {
        offsetMs: 600,
        action: 'CLEAR_FAULT',
        faultId: 'f-200'
      }
    ]);

    const applied = new Set<number>();

    // At offset 100: no events fired
    timeline.applyUpTo(100, registry, applied);
    expect(registry.getActiveRules()).toHaveLength(0);

    // At offset 300: event 0 fired
    timeline.applyUpTo(300, registry, applied);
    expect(registry.getActiveRules()).toHaveLength(1);
    expect(registry.getRule('f-200')).toBeDefined();

    // At offset 700: event 1 fired, rule cleared
    timeline.applyUpTo(700, registry, applied);
    expect(registry.getActiveRules()).toHaveLength(0);
  });
});
