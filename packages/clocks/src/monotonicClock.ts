export interface MonotonicClock {
  /** Returns monotonic time in nanoseconds */
  nowNs(): bigint;
  /** Returns monotonic time in milliseconds */
  nowMs(): number;
  /** Computes elapsed time in nanoseconds between start and end */
  elapsedNs(startNs: bigint, endNs?: bigint): bigint;
  /** Computes elapsed time in milliseconds */
  elapsedMs(startNs: bigint, endNs?: bigint): number;
}

export class SystemMonotonicClock implements MonotonicClock {
  public nowNs(): bigint {
    return process.hrtime.bigint();
  }

  public nowMs(): number {
    return Number(process.hrtime.bigint()) / 1_000_000;
  }

  public elapsedNs(startNs: bigint, endNs?: bigint): bigint {
    const end = endNs ?? this.nowNs();
    return end - startNs;
  }

  public elapsedMs(startNs: bigint, endNs?: bigint): number {
    const delta = this.elapsedNs(startNs, endNs);
    return Number(delta) / 1_000_000;
  }
}
