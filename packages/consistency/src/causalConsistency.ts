import { VersionFrontier } from './versionFrontier.js';
import { mergeVectorClocks } from './vectorClock.js';

export type CausalFrontier = Record<string, number>;

/**
 * Checks if a given replica's version frontier satisfies a client's causal dependency.
 */
export function satisfiesCausalDependency(
  frontier: VersionFrontier,
  dependency: CausalFrontier
): boolean {
  for (const [nodeId, requiredCounter] of Object.entries(dependency)) {
    const req = Number(requiredCounter);
    if (req <= 0) continue;

    let satisfiedForNode = false;
    for (const v of frontier.maximalVersions) {
      const dotCounter = v.dot?.nodeId === nodeId ? Number(v.dot.counter) : 0;
      const vcCounter = Number(v.vectorClock?.[nodeId] ?? 0);
      const vCounter = Math.max(dotCounter, vcCounter);
      if (vCounter >= req) {
        satisfiedForNode = true;
        break;
      }
    }

    if (!satisfiedForNode) {
      return false;
    }
  }

  return true;
}

/**
 * Tracks and advances a client session's causal frontier.
 */
export class CausalSessionTracker {
  private frontier: CausalFrontier = {};

  constructor(initialFrontier?: CausalFrontier) {
    if (initialFrontier) {
      this.frontier = { ...initialFrontier };
    }
  }

  public getFrontier(): CausalFrontier {
    return { ...this.frontier };
  }

  /**
   * Advances the causal frontier after observing or writing an entry.
   */
  public advance(observedVectorClock: CausalFrontier): void {
    this.frontier = mergeVectorClocks(this.frontier, observedVectorClock);
  }

  /**
   * Encodes the causal session into a portable token string.
   */
  public encodeToken(): string {
    return Buffer.from(JSON.stringify(this.frontier), 'utf8').toString('base64');
  }

  /**
   * Decodes a portable token string into a causal frontier.
   */
  public static decodeToken(token: string): CausalFrontier {
    try {
      const json = Buffer.from(token, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch {
      return {};
    }
  }
}
