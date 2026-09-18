import { VersionStamp } from './versionStamp.js';
import { VersionFrontier } from './versionFrontier.js';
import { mergeVectorClocks } from './vectorClock.js';
import { satisfiesCausalDependency } from './causalConsistency.js';

export interface SerializedSessionToken {
  readonly sessionId: string;
  readonly frontier: Record<string, number>;
  readonly timestampMs: number;
}

/**
 * Manages client session state to enforce the four classic session guarantees:
 * 1. Read-Your-Writes (RYW)
 * 2. Monotonic Reads (MR)
 * 3. Monotonic Writes (MW)
 * 4. Writes-Follow-Reads (WFR)
 */
export class ClientSessionContext {
  public readonly sessionId: string;
  private frontier: Record<string, number> = {};
  private lastObservedStamp?: VersionStamp;

  constructor(sessionId: string, initialFrontier?: Record<string, number>) {
    this.sessionId = sessionId;
    if (initialFrontier) {
      for (const [k, v] of Object.entries(initialFrontier)) {
        this.frontier[k] = Number(v);
      }
    }
  }

  public getFrontier(): Readonly<Record<string, number>> {
    return { ...this.frontier };
  }

  public getLastObservedStamp(): VersionStamp | undefined {
    return this.lastObservedStamp;
  }

  /**
   * Records a local or remote write mutation executed in this session.
   * Enforces Read-Your-Writes (RYW) and Monotonic Writes (MW).
   */
  public recordWrite(version: VersionStamp): void {
    this.lastObservedStamp = version;

    // 1. Advance frontier with dot counter
    const dotNode = version.dot.nodeId;
    const dotCount = Number(version.dot.counter);
    this.frontier[dotNode] = Math.max(Number(this.frontier[dotNode] ?? 0), dotCount);

    // 2. Advance frontier with version's full vector clock
    if (version.vectorClock) {
      this.frontier = mergeVectorClocks(this.frontier, version.vectorClock);
    }
  }

  /**
   * Records versions observed from a read operation in this session.
   * Enforces Monotonic Reads (MR) and Writes-Follow-Reads (WFR).
   */
  public recordRead(frontier: VersionFrontier): void {
    for (const v of frontier.maximalVersions) {
      this.lastObservedStamp = v;
      const dotNode = v.dot.nodeId;
      const dotCount = Number(v.dot.counter);
      this.frontier[dotNode] = Math.max(Number(this.frontier[dotNode] ?? 0), dotCount);

      if (v.vectorClock) {
        this.frontier = mergeVectorClocks(this.frontier, v.vectorClock);
      }
    }
  }

  /**
   * Checks whether a replica's frontier satisfies this session's required visibility.
   */
  public satisfiesSession(replicaFrontier: VersionFrontier): boolean {
    return satisfiesCausalDependency(replicaFrontier, this.frontier);
  }

  /**
   * Encodes the session context into a portable base64 token string.
   */
  public encodeToken(): string {
    const payload: SerializedSessionToken = {
      sessionId: this.sessionId,
      frontier: this.frontier,
      timestampMs: Date.now()
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  /**
   * Decodes a portable base64 token string into a ClientSessionContext.
   */
  public static decodeToken(tokenString: string): ClientSessionContext {
    try {
      const jsonStr = Buffer.from(tokenString, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonStr) as SerializedSessionToken;
      return new ClientSessionContext(parsed.sessionId, parsed.frontier);
    } catch (err: any) {
      throw new Error(`Invalid session token: ${err?.message ?? 'Malformed base64 token'}`);
    }
  }
}

/**
 * Validates adherence to the four session guarantees for auditing and verification.
 */
export class SessionGuaranteeVerifier {
  /**
   * Validates Read-Your-Writes: observed read version must be >= the session's previous write version.
   */
  public static verifyReadYourWrites(
    written: VersionStamp | ClientSessionContext,
    readFrontier: VersionFrontier
  ): boolean {
    if (written instanceof ClientSessionContext) {
      return written.satisfiesSession(readFrontier);
    }
    const writtenNode = written.dot.nodeId;
    const writtenCounter = Number(written.dot.counter);

    for (const observed of readFrontier.maximalVersions) {
      const observedDot = observed.dot.nodeId === writtenNode ? Number(observed.dot.counter) : 0;
      const observedVc = Number(observed.vectorClock[writtenNode] ?? 0);
      if (Math.max(observedDot, observedVc) >= writtenCounter) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validates Monotonic Reads: current read version must be >= previous read version.
   */
  public static verifyMonotonicReads(
    previous: VersionFrontier | ClientSessionContext,
    currentReadFrontier: VersionFrontier
  ): boolean {
    if (previous instanceof ClientSessionContext) {
      return previous.satisfiesSession(currentReadFrontier);
    }
    for (const prev of previous.maximalVersions) {
      const prevNode = prev.dot.nodeId;
      const prevCounter = Number(prev.dot.counter);

      let foundGeq = false;
      for (const curr of currentReadFrontier.maximalVersions) {
        const currDot = curr.dot.nodeId === prevNode ? Number(curr.dot.counter) : 0;
        const currVc = Number(curr.vectorClock[prevNode] ?? 0);
        if (Math.max(currDot, currVc) >= prevCounter) {
          foundGeq = true;
          break;
        }
      }
      if (!foundGeq) return false;
    }
    return true;
  }

  /**
   * Validates Monotonic Writes: a new write must not regress relative to previous writes within the session.
   */
  public static verifyMonotonicWrites(
    session: ClientSessionContext,
    candidateWrite: VersionStamp
  ): boolean {
    const node = candidateWrite.dot.nodeId;
    const counter = Number(candidateWrite.dot.counter);
    const prevCounter = Number(session.getFrontier()[node] ?? 0);
    return counter >= prevCounter;
  }

  /**
   * Validates Writes-Follow-Reads: a new write must causally succeed all reads previously observed in the session.
   */
  public static verifyWritesFollowReads(
    session: ClientSessionContext,
    candidateWrite: VersionStamp
  ): boolean {
    const vc = candidateWrite.vectorClock ?? {};
    for (const [nodeId, requiredCounter] of Object.entries(session.getFrontier())) {
      const actualCounter = Number(vc[nodeId] ?? 0);
      const dotCounter = candidateWrite.dot.nodeId === nodeId ? Number(candidateWrite.dot.counter) : 0;
      if (Math.max(actualCounter, dotCounter) < Number(requiredCounter)) {
        return false;
      }
    }
    return true;
  }
}
