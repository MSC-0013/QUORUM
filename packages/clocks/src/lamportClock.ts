export interface LamportClock {
  /** Returns the current logical timestamp */
  now(): bigint;
  /** Increments the local logical clock and returns the new value */
  tick(): bigint;
  /** Updates the local logical clock upon receiving a remote timestamp: max(local, remote) + 1 */
  witness(remoteTime: bigint): bigint;
}

export class LogicalLamportClock implements LamportClock {
  private counter: bigint;

  constructor(initial = 0n) {
    if (initial < 0n) {
      throw new Error(`Initial Lamport timestamp must be non-negative, got ${initial}`);
    }
    this.counter = initial;
  }

  public now(): bigint {
    return this.counter;
  }

  public tick(): bigint {
    this.counter += 1n;
    return this.counter;
  }

  public witness(remoteTime: bigint): bigint {
    this.counter = (this.counter > remoteTime ? this.counter : remoteTime) + 1n;
    return this.counter;
  }
}
