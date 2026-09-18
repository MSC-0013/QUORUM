import { PercentileCollector, LatencyStatistics, ConfidenceInterval, computeBootstrapConfidenceInterval } from './stats.js';
import { WorkloadGenerator, BenchmarkWorkloadConfig, WorkloadProfile } from './workload.js';

export interface BenchmarkClientTarget {
  get(key: string): Promise<{ found: boolean; value?: Uint8Array; version?: any }>;
  put(key: string, value: Uint8Array): Promise<{ version: any; ackCount?: number }>;
}

export interface BenchmarkRunResult {
  readonly tier: 'TIER_A' | 'TIER_B' | 'TIER_C';
  readonly name: string;
  readonly replicationEngine: string;
  readonly consistencyLevel: string;
  readonly workload: WorkloadProfile;
  readonly distribution: 'UNIFORM' | 'ZIPFIAN';
  readonly totalOperations: number;
  readonly overallStats: LatencyStatistics;
  readonly readStats: LatencyStatistics;
  readonly writeStats: LatencyStatistics;
  readonly confidenceInterval: ConfidenceInterval;
  readonly violations: {
    staleReads: number;
    writeFailures: number;
  };
}

export interface BenchmarkExecutionOptions {
  tier?: 'TIER_A' | 'TIER_B' | 'TIER_C';
  warmupOperations?: number;
  replicationEngine?: string;
  consistencyLevel?: string;
}

/**
 * High-performance benchmark harness.
 */
export class BenchmarkRunner {
  public async execute(
    target: BenchmarkClientTarget,
    config: BenchmarkWorkloadConfig,
    name: string,
    options?: BenchmarkExecutionOptions
  ): Promise<BenchmarkRunResult> {
    const generator = new WorkloadGenerator(config);
    const warmupCount = options?.warmupOperations ?? Math.min(50, Math.floor(config.totalOperations * 0.1));

    // 1. Warmup phase (excluded from latency recording)
    for (let i = 0; i < warmupCount; i++) {
      const op = generator.nextOperation();
      if (op.type === 'GET') {
        await target.get(op.key).catch(() => {});
      } else {
        await target.put(op.key, op.value ?? new Uint8Array()).catch(() => {});
      }
    }

    // 2. Measurement phase
    const overallCollector = new PercentileCollector();
    const readCollector = new PercentileCollector();
    const writeCollector = new PercentileCollector();

    let staleReads = 0;
    let writeFailures = 0;

    // Track latest written versions per key to audit stale read rate
    const latestKnownVersions = new Map<string, number>();

    overallCollector.start();
    readCollector.start();
    writeCollector.start();

    const plan = generator.generateAll();

    for (const op of plan) {
      const opStart = performance.now();
      try {
        if (op.type === 'GET') {
          const res = await target.get(op.key);
          const elapsed = performance.now() - opStart;
          overallCollector.record(elapsed);
          readCollector.record(elapsed);

          // Audit consistency: if key was previously written, did read return stale empty state?
          const expectedCounter = latestKnownVersions.get(op.key);
          if (expectedCounter !== undefined) {
            const observedCounter = res.version?.dot?.counter ?? 0;
            if (!res.found || observedCounter < expectedCounter) {
              staleReads++;
            }
          }
        } else {
          const res = await target.put(op.key, op.value ?? new Uint8Array());
          const elapsed = performance.now() - opStart;
          overallCollector.record(elapsed);
          writeCollector.record(elapsed);

          if (res.version?.dot?.counter) {
            latestKnownVersions.set(op.key, res.version.dot.counter);
          }
        }
      } catch {
        writeFailures++;
      }
    }

    overallCollector.stop();
    readCollector.stop();
    writeCollector.stop();

    const overallStats = overallCollector.compute();
    const readStats = readCollector.compute();
    const writeStats = writeCollector.compute();

    const ci = computeBootstrapConfidenceInterval(
      overallCollector.getRawLatencies(),
      (s) => s.reduce((a, b) => a + b, 0) / (s.length || 1),
      'meanLatencyMs',
      1000,
      config.seed ?? 42
    );

    return {
      tier: options?.tier ?? 'TIER_A',
      name,
      replicationEngine: options?.replicationEngine ?? 'LEADERLESS',
      consistencyLevel: options?.consistencyLevel ?? 'QUORUM',
      workload: config.profile,
      distribution: config.distribution,
      totalOperations: config.totalOperations,
      overallStats,
      readStats,
      writeStats,
      confidenceInterval: ci,
      violations: {
        staleReads,
        writeFailures
      }
    };
  }
}
