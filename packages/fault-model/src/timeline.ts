import { FaultRule } from './types.js';
import { FaultRegistry } from './faultRegistry.js';

export interface TimelineEvent {
  readonly offsetMs: number;
  readonly action: 'SET_FAULT' | 'CLEAR_FAULT';
  readonly rule?: FaultRule;
  readonly faultId?: string;
  readonly durationMs?: number;
}

export class ExperimentTimeline {
  private readonly events: TimelineEvent[] = [];

  constructor(initialEvents: readonly TimelineEvent[] = []) {
    // Automatically expand events that specify durationMs into a pair of SET_FAULT and CLEAR_FAULT
    for (const ev of initialEvents) {
      this.events.push(ev);
      if (ev.action === 'SET_FAULT' && ev.durationMs && ev.durationMs > 0 && ev.rule) {
        this.events.push({
          offsetMs: ev.offsetMs + ev.durationMs,
          action: 'CLEAR_FAULT',
          faultId: ev.rule.faultId
        });
      }
    }

    // Sort strictly by offsetMs ascending, with CLEAR_FAULT tie-breaking before SET_FAULT at identical offsets
    this.events.sort((a, b) => {
      if (a.offsetMs !== b.offsetMs) {
        return a.offsetMs - b.offsetMs;
      }
      return a.action === 'CLEAR_FAULT' ? -1 : 1;
    });
  }

  public getEvents(): readonly TimelineEvent[] {
    return this.events;
  }

  /**
   * Applies all timeline events up to the given monotonic offset to the target registry.
   */
  public applyUpTo(offsetMs: number, registry: FaultRegistry, appliedIndices: Set<number>): void {
    for (let i = 0; i < this.events.length; i++) {
      if (appliedIndices.has(i)) continue;

      const event = this.events[i]!;
      if (event.offsetMs <= offsetMs) {
        if (event.action === 'SET_FAULT' && event.rule) {
          registry.setRule(event.rule);
        } else if (event.action === 'CLEAR_FAULT' && event.faultId) {
          registry.clearRule(event.faultId);
        }
        appliedIndices.add(i);
      }
    }
  }
}
