import { describe, it, expect } from 'vitest';
import {
  SystemWallClock,
  SystemMonotonicClock,
  LogicalLamportClock
} from '../src/index.js';

describe('Clocks: WallClock', () => {
  it('returns current time in milliseconds', () => {
    const clock = new SystemWallClock();
    const before = Date.now();
    const t = clock.nowMs();
    const after = Date.now();

    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('correctly applies skew offset for fault injection', () => {
    const clock = new SystemWallClock();
    const baseline = clock.nowMs();

    clock.setSkewOffsetMs(5000);
    expect(clock.getSkewOffsetMs()).toBe(5000);
    const skewed = clock.nowMs();

    expect(skewed - baseline).toBeGreaterThanOrEqual(4900);
  });
});

describe('Clocks: MonotonicClock', () => {
  it('strictly increases monotonically', () => {
    const clock = new SystemMonotonicClock();
    const t1 = clock.nowNs();
    const t2 = clock.nowNs();

    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('calculates elapsed time accurately', async () => {
    const clock = new SystemMonotonicClock();
    const start = clock.nowNs();

    await new Promise((resolve) => setTimeout(resolve, 15));

    const elapsedMs = clock.elapsedMs(start);
    expect(elapsedMs).toBeGreaterThanOrEqual(10);
    expect(elapsedMs).toBeLessThan(100);
  });
});

describe('Clocks: LamportClock', () => {
  it('ticks monotonically', () => {
    const clock = new LogicalLamportClock();
    expect(clock.now()).toBe(0n);
    expect(clock.tick()).toBe(1n);
    expect(clock.tick()).toBe(2n);
    expect(clock.now()).toBe(2n);
  });

  it('witnesses remote timestamp and advances beyond max', () => {
    const clock = new LogicalLamportClock(5n);
    // Local is 5n, remote arrives with 12n
    const advanced = clock.witness(12n);
    expect(advanced).toBe(13n);
    expect(clock.now()).toBe(13n);

    // Local is 13n, smaller remote arrives with 4n
    const next = clock.witness(4n);
    expect(next).toBe(14n);
  });
});
