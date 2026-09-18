# QUORUM LAB — Frozen Benchmark Methodology

## Overview

This document formalizes the rigorous, frozen benchmarking methodology for QUORUM LAB (§Q11).

In distributed systems research, benchmarking results are only comparable when the evaluation harness, distribution seeds, warmup periods, and statistical aggregation procedures are fixed prior to measurement execution.

---

## 1. Evaluation Matrix & Three-Tier Hierarchy

The Cartesian product of nodes ($1, 3, 5, 7, 9$) $\times$ throughput target ($100, 1\text{k}, 5\text{k}, 10\text{k}$ RPS) $\times$ replication engine (`LEADERLESS`, `LEADER`, `RAFT`) $\times$ consistency (`ONE`, `QUORUM`, `ALL`, `SESSION`, `CAUSAL`, `EVENTUAL`) $\times$ workload profile (`READ_HEAVY`, `WRITE_HEAVY`, `BALANCED`, `HOT_KEY`) $\times$ failure model (`NONE`, `DELAY`, `LOSS`, `PARTITION`, `CRASH_RECOVERY`) exceeds 14,000 raw permutations.

To achieve empirical rigor and reproducible outcomes, experiments are structured into three standardized tiers:

| Tier | Scope | Node Sizes | Target Load | Failure Modes | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier A (Smoke)** | Sanity & Fast Pass | $1, 3, 5$ nodes | $100, 1\text{k}$ RPS | `NONE` | Fast CI regression pass (< 60s) |
| **Tier B (Core)** | Comparative Matrix | $3, 5, 7$ nodes | $1\text{k}, 5\text{k}$ RPS | `NONE` | Main comparative dataset across engines & consistency levels |
| **Tier C (Research)** | Chaos & Divergence | $3, 5$ nodes | $1\text{k}, 5\text{k}$ RPS | `PARTITION`, `SKEW`, `CRASH` | Measures divergence rate, stale reads, and repair recovery latency |

---

## 2. Frozen Methodology Specification

```yaml
methodology_version: "1.0.0"
seeds:
  evaluation_seeds: [42, 99, 1337, 2026, 8888]
  note: "Fixed seed set reused across all compared configurations; fresh random seeds are never used for comparative experiments."

repetitions:
  tier_a: 3
  tier_b: 10
  tier_c: 10
  minimum_successful_runs: 9

durations:
  warmup_duration_seconds: 30
  measurement_duration_seconds: 120
  note: "Warmup phase traffic is completely excluded from latency percentiles and statistical recording."

statistical_aggregation:
  percentiles: [p50, p90, p95, p99, p99.9, max]
  percentile_method: "nearest_rank_pooled"
  confidence_interval:
    method: "bootstrap"
    confidence_level: 0.95
    resamples: 1000
  outlier_handling: "none"
  note: "Outliers are never trimmed or discarded; tail latency spikes reflect actual distributed coordination and GC pauses."

workload_profiles:
  read_heavy:
    read_ratio: 0.90
    write_ratio: 0.10
  write_heavy:
    read_ratio: 0.10
    write_ratio: 0.90
  balanced:
    read_ratio: 0.50
    write_ratio: 0.50

key_distributions:
  uniform:
    type: "PRNG_Mulberry32"
  zipfian:
    type: "YCSB_Gray_Zipfian"
    theta: 0.99
    keyspace_size: 10000

hardware_and_environment:
  runtime: "Node.js v24.12.0 LTS"
  os: "Windows / Linux x86_64"
  concurrency: [1, 4, 16, 64, 128]
  value_size_bytes: 128
```

---

## 3. Success & Audit Criteria

A benchmark run is designated **VALID** and accepted into the research dataset if and only if:
1. **Quorum Safety**: Zero split-brain or stale writes bypass fencing tokens under `LEADER`.
2. **Linearizability Safety**: Zero stale reads or non-monotonic regressions occur under `RAFT` or `STRICT_LINEARIZABLE`.
3. **Session Monotonicity**: Zero Read-Your-Writes or Monotonic-Reads violations occur when client supplies session token.
4. **Completion Rate**: $\ge 99.0\%$ of requests complete within client timeout under non-partitioned workloads.
