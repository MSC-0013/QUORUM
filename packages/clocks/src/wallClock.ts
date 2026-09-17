export interface WallClock {
  /** Returns current wall time in milliseconds since Unix epoch */
  nowMs(): number;
  /** Sets an artificial skew offset (used for clock-skew fault injection) */
  setSkewOffsetMs(offsetMs: number): void;
  getSkewOffsetMs(): number;
}

export class SystemWallClock implements WallClock {
  private skewOffsetMs = 0;

  public nowMs(): number {
    return Date.now() + this.skewOffsetMs;
  }

  public setSkewOffsetMs(offsetMs: number): void {
    this.skewOffsetMs = offsetMs;
  }

  public getSkewOffsetMs(): number {
    return this.skewOffsetMs;
  }
}
