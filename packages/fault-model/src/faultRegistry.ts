import {
  FaultRule,
  FaultEvaluationContext,
  FaultDecision
} from './types.js';
import { DeterministicRng } from './prng.js';

export class FaultRegistry {
  private readonly rules = new Map<string, FaultRule>();
  private readonly rng: DeterministicRng;

  constructor(rng?: DeterministicRng) {
    this.rng = rng ?? new DeterministicRng(123456789);
  }

  public setRule(rule: FaultRule): void {
    this.rules.set(rule.faultId, rule);
  }

  public clearRule(faultId: string): boolean {
    return this.rules.delete(faultId);
  }

  public clearAll(): number {
    const count = this.rules.size;
    this.rules.clear();
    return count;
  }

  public getRule(faultId: string): FaultRule | undefined {
    return this.rules.get(faultId);
  }

  public getActiveRules(): readonly FaultRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Evaluates active fault rules against a specific operational context.
   */
  public evaluate(ctx: FaultEvaluationContext): FaultDecision {
    const active = this.getActiveRules();

    for (const rule of active) {
      if (rule.scope !== ctx.scope) {
        continue;
      }

      // Check target node match
      if (rule.targetNodeId && rule.targetNodeId !== ctx.localNodeId) {
        continue;
      }

      // Check peer node match if specified
      if (
        rule.peerNodeId &&
        ctx.peerNodeId &&
        rule.peerNodeId !== ctx.peerNodeId
      ) {
        continue;
      }

      // Handle specific fault types
      switch (rule.type) {
        case 'PARTITION': {
          // If partition is specified for peerNodeId or applies to all peers
          if (!rule.peerNodeId || rule.peerNodeId === ctx.peerNodeId) {
            return {
              allow: false,
              drop: true,
              injectError: `NETWORK_PARTITION between ${ctx.localNodeId} and ${ctx.peerNodeId ?? 'all'}`
            };
          }
          break;
        }

        case 'LOSS': {
          const prob = rule.probability ?? 1.0;
          if (this.rng.nextBool(prob)) {
            return {
              allow: false,
              drop: true,
              injectError: `NETWORK_LOSS packet dropped (p=${prob})`
            };
          }
          break;
        }

        case 'DELAY': {
          if (rule.delayMs && rule.delayMs > 0) {
            return {
              allow: true,
              delayMs: rule.delayMs
            };
          }
          break;
        }

        case 'WRITE_FAILURE': {
          if (ctx.operationType === 'WRITE') {
            return {
              allow: false,
              injectError: 'INJECTED_WRITE_FAILURE'
            };
          }
          break;
        }

        case 'READ_FAILURE': {
          if (ctx.operationType === 'READ') {
            return {
              allow: false,
              injectError: 'INJECTED_READ_FAILURE'
            };
          }
          break;
        }

        case 'SLOW_DISK': {
          if (rule.delayMs && rule.delayMs > 0) {
            return {
              allow: true,
              delayMs: rule.delayMs
            };
          }
          break;
        }
      }
    }

    return { allow: true };
  }

  /**
   * Retrieves active clock skew offset in milliseconds, if any.
   */
  public getActiveClockSkewMs(nodeId: string): number {
    for (const rule of this.rules.values()) {
      if (
        rule.type === 'CLOCK_SKEW' &&
        rule.scope === 'CLOCK' &&
        (!rule.targetNodeId || rule.targetNodeId === nodeId)
      ) {
        return rule.clockSkewMs ?? 0;
      }
    }
    return 0;
  }
}
