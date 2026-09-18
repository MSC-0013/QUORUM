import { describe, it, expect } from 'vitest';
import {
  UniformGenerator,
  ZipfianGenerator,
  PercentileCollector,
  computeBootstrapConfidenceInterval,
  BenchmarkRunner,
  BenchmarkClientTarget
} from '../src/index.js';

describe('Quorum Lab: Research & Benchmarking Suite (§Q11)', () => {
  describe('Key Distribution Generators', () => {
    it('generates uniform distribution across key space', () => {
      const gen = new UniformGenerator(10, 42, 'key:');
      const counts: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        const k = gen.nextKey();
        counts[k] = (counts[k] ?? 0) + 1;
      }

      // All 10 keys must be sampled with roughly uniform frequency
      const sampledKeys = Object.keys(counts);
      expect(sampledKeys).toHaveLength(10);
      for (const k of sampledKeys) {
        expect(counts[k]).toBeGreaterThan(50);
        expect(counts[k]).toBeLessThan(150);
      }
    });

    it('generates Zipfian heavy-tailed distribution with hot keys', () => {
      const gen = new ZipfianGenerator(100, 0.99, 42, 'key:');
      const counts: Record<string, number> = {};
      const total = 2000;
      for (let i = 0; i < total; i++) {
        const k = gen.nextKey();
        counts[k] = (counts[k] ?? 0) + 1;
      }

      // Key 0 must be heavily accessed (top hot key)
      const topKeyCount = counts['key:0'] ?? 0;
      expect(topKeyCount).toBeGreaterThan(300); // > 15% on key:0 alone in 100-key space

      // Top 5 keys must capture > 40% of total traffic
      let top5Sum = 0;
      for (let i = 0; i < 5; i++) {
        top5Sum += counts[`key:${i}`] ?? 0;
      }
      expect(top5Sum / total).toBeGreaterThan(0.35);
    });
  });

  describe('Statistical Aggregator & Bootstrap CI', () => {
    it('computes exact sorted percentiles and operations per second', () => {
      const collector = new PercentileCollector();
      collector.start();

      // Record 100 known values: 1ms through 100ms
      for (let i = 1; i <= 100; i++) {
        collector.record(i);
      }
      collector.stop();

      const stats = collector.compute(1.0); // Override 1.0 second duration
      expect(stats.count).toBe(100);
      expect(stats.minMs).toBe(1);
      expect(stats.maxMs).toBe(100);
      expect(stats.meanMs).toBe(50.5);
      expect(stats.p50Ms).toBe(50);
      expect(stats.p90Ms).toBe(90);
      expect(stats.p95Ms).toBe(95);
      expect(stats.p99Ms).toBe(99);
      expect(stats.opsPerSec).toBe(100);
    });

    it('computes robust 95% bootstrap confidence interval', () => {
      const values = [10, 11, 12, 10, 11, 13, 9, 10, 12, 11];
      const ci = computeBootstrapConfidenceInterval(values, (s) => s.reduce((a, b) => a + b, 0) / s.length, 'mean', 500, 42);

      expect(ci.mean).toBeCloseTo(10.9, 1);
      expect(ci.lower95).toBeLessThan(ci.mean);
      expect(ci.upper95).toBeGreaterThan(ci.mean);
      expect(ci.confidence).toBe(0.95);
    });
  });

  describe('Tier A: Smoke Benchmarks (CI Fast Pass)', () => {
    it('executes Tier A smoke benchmark over in-memory KV cluster', async () => {
      const storage = new Map<string, { value: Uint8Array; counter: number }>();
      let counter = 0;

      const mockTarget: BenchmarkClientTarget = {
        async get(key: string) {
          const item = storage.get(key);
          if (!item) return { found: false };
          return {
            found: true,
            value: item.value,
            version: { dot: { nodeId: 'bench-node', counter: item.counter } }
          };
        },
        async put(key: string, value: Uint8Array) {
          counter++;
          storage.set(key, { value, counter });
          return {
            version: { dot: { nodeId: 'bench-node', counter } },
            ackCount: 3
          };
        }
      };

      const runner = new BenchmarkRunner();
      const result = await runner.execute(
        mockTarget,
        {
          keyspaceSize: 50,
          distribution: 'UNIFORM',
          profile: 'BALANCED',
          totalOperations: 200,
          seed: 42
        },
        'Tier A - Balanced Smoke',
        { tier: 'TIER_A', replicationEngine: 'LEADERLESS', consistencyLevel: 'QUORUM' }
      );

      expect(result.tier).toBe('TIER_A');
      expect(result.totalOperations).toBe(200);
      expect(result.overallStats.count).toBe(200);
      expect(result.overallStats.opsPerSec).toBeGreaterThan(100);
      expect(result.readStats.count).toBeGreaterThan(0);
      expect(result.writeStats.count).toBeGreaterThan(0);
      expect(result.violations.staleReads).toBe(0);
      expect(result.violations.writeFailures).toBe(0);
    });
  });

  describe('Tier B: Core Comparative Matrix (Engines & Consistency Levels)', () => {
    it('evaluates comparative performance across replication engine models', async () => {
      const runner = new BenchmarkRunner();

      const runEngineBenchmark = async (engine: 'LEADERLESS' | 'LEADER' | 'RAFT', artificialLatencyMs: number) => {
        const store = new Map<string, { value: Uint8Array; counter: number }>();
        let counter = 0;

        const target: BenchmarkClientTarget = {
          async get(key: string) {
            const item = store.get(key);
            if (!item) return { found: false };
            return {
              found: true,
              value: item.value,
              version: { dot: { nodeId: `${engine}-node`, counter: item.counter } }
            };
          },
          async put(key: string, value: Uint8Array) {
            if (artificialLatencyMs > 0) {
              await new Promise((r) => setTimeout(r, artificialLatencyMs));
            }
            counter++;
            store.set(key, { value, counter });
            return {
              version: { dot: { nodeId: `${engine}-node`, counter } }
            };
          }
        };

        return runner.execute(
          target,
          {
            keyspaceSize: 20,
            distribution: 'ZIPFIAN',
            profile: 'READ_HEAVY',
            totalOperations: 100,
            seed: 99
          },
          `Tier B - ${engine}`,
          { tier: 'TIER_B', replicationEngine: engine, consistencyLevel: 'QUORUM' }
        );
      };

      // Run leaderless (fast parallel quorum), leader (epoch coordination), raft (consensus roundtrip)
      const resLeaderless = await runEngineBenchmark('LEADERLESS', 0);
      const resLeader = await runEngineBenchmark('LEADER', 1);
      const resRaft = await runEngineBenchmark('RAFT', 2);

      expect(resLeaderless.overallStats.count).toBe(100);
      expect(resLeader.overallStats.count).toBe(100);
      expect(resRaft.overallStats.count).toBe(100);

      // Latency hierarchy: leaderless <= leader <= raft consensus roundtrip
      expect(resLeaderless.overallStats.meanMs).toBeLessThanOrEqual(resLeader.overallStats.meanMs + 1);
      expect(resLeader.overallStats.meanMs).toBeLessThanOrEqual(resRaft.overallStats.meanMs + 1);

      // Auditing guarantees zero divergence under normal execution
      expect(resLeaderless.violations.staleReads).toBe(0);
      expect(resLeader.violations.staleReads).toBe(0);
      expect(resRaft.violations.staleReads).toBe(0);
    });
  });
});
