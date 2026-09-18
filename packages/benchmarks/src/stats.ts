import { createPrng } from './distributions.js';

export interface LatencyStatistics {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly p999Ms: number;
  readonly durationSec: number;
  readonly opsPerSec: number;
}

export interface ConfidenceInterval {
  readonly metric: string;
  readonly mean: number;
  readonly lower95: number;
  readonly upper95: number;
  readonly confidence: number;
}

/**
 * High-precision latency percentile collector.
 */
export class PercentileCollector {
  private readonly latencies: number[] = [];
  private startTime = 0;
  private endTime = 0;

  public start(): void {
    this.startTime = performance.now();
  }

  public record(latencyMs: number): void {
    this.latencies.push(latencyMs);
  }

  public stop(): void {
    this.endTime = performance.now();
  }

  public getCount(): number {
    return this.latencies.length;
  }

  public getRawLatencies(): readonly number[] {
    return this.latencies;
  }

  public compute(durationSecOverride?: number): LatencyStatistics {
    const count = this.latencies.length;
    if (count === 0) {
      return {
        count: 0,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p90Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        p999Ms: 0,
        durationSec: 0,
        opsPerSec: 0
      };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += sorted[i]!;
    }
    const meanMs = sum / count;

    const getP = (p: number) => {
      const idx = Math.min(count - 1, Math.max(0, Math.ceil((p / 100) * count) - 1));
      return sorted[idx]!;
    };

    const durationSec = durationSecOverride ?? Math.max(0.001, (this.endTime - this.startTime) / 1000);
    const opsPerSec = count / durationSec;

    return {
      count,
      minMs: sorted[0]!,
      maxMs: sorted[count - 1]!,
      meanMs,
      p50Ms: getP(50),
      p90Ms: getP(90),
      p95Ms: getP(95),
      p99Ms: getP(99),
      p999Ms: getP(99.9),
      durationSec,
      opsPerSec
    };
  }
}

/**
 * Calculates 95% Bootstrap Confidence Interval over B resamples with replacement.
 */
export function computeBootstrapConfidenceInterval(
  values: readonly number[],
  metricFn: (sample: number[]) => number = (s) => s.reduce((a, b) => a + b, 0) / s.length,
  metricName = 'mean',
  bootstrapReps = 1000,
  seed = 12345
): ConfidenceInterval {
  const n = values.length;
  if (n === 0) {
    return { metric: metricName, mean: 0, lower95: 0, upper95: 0, confidence: 0.95 };
  }

  const rng = createPrng(seed);
  const sampleMeans: number[] = [];

  for (let b = 0; b < bootstrapReps; b++) {
    const resample: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const pickIdx = Math.floor(rng() * n);
      resample[i] = values[pickIdx]!;
    }
    sampleMeans.push(metricFn(resample));
  }

  sampleMeans.sort((a, b) => a - b);

  const lowerIdx = Math.floor(0.025 * bootstrapReps);
  const upperIdx = Math.floor(0.975 * bootstrapReps);

  let origSum = 0;
  for (const v of values) origSum += v;
  const originalEstimate = origSum / n;

  return {
    metric: metricName,
    mean: originalEstimate,
    lower95: sampleMeans[lowerIdx]!,
    upper95: sampleMeans[upperIdx]!,
    confidence: 0.95
  };
}
