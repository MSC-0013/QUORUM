# SYSTEM-X: BLACKBOX-X × QUORUM LAB Integration Architecture

## 1. Executive Mission & Core Invariant

> **The Architectural Golden Rule**:
> **Do NOT merge BLACKBOX-X and QUORUM LAB internally.**
> Keep both platforms independently deployable, independently tested, and independently correct.
> Connect them exclusively through a **dedicated, third architectural boundary**: the **SYSTEM-X Integration Layer**.

```text
                BLACKBOX-X
        "What should happen?"
                  │
                  │ model
                  ▼
        simulation / prediction
                  │
                  │ predicted behavior
                  ▼
        ┌─────────────────────┐
        │   SYSTEM-X BRIDGE   │
        └─────────────────────┘
                  │
                  │ experiment + workload
                  ▼
              QUORUM LAB
       "What actually happens?"
                  │
                  │ real distributed
                  │ execution
                  ▼
       consistency / failures /
       latency / throughput /
       divergence / repair
                  │
                  ▼
        empirical measurements
                  │
                  └───────────────┐
                                  ▼
                           BLACKBOX-X
                         Compare → Calibrate
                                  │
                                  ▼
                           Better model
```

---

## 2. Ownership & Responsibility Boundaries

Neither repository imports the other's internal classes, database tables, or private packages.

| Responsibility | BLACKBOX-X | QUORUM LAB | SYSTEM-X Bridge |
| :--- | :---: | :---: | :---: |
| **Topology & Architecture DAG** | ✅ | | |
| **Discrete-Event Queueing Simulation (DES)** | ✅ | | |
| **Capacity Search & Bottleneck Attribution** | ✅ | | |
| **Parameter Calibration (Coordinate Descent)** | ✅ | | |
| **Statistical Model Comparison (KS / Wasserstein)** | ✅ | | |
| **Replication Engines (Leaderless / Leader / Raft)** | | ✅ | |
| **Consistency Models & Vector Clocks** | | ✅ | |
| **Fault Injection into Real Nodes (Partitions, Delays)** | | ✅ | |
| **Merkle Tree Anti-Entropy & Quorum Read Repair** | | ✅ | |
| **Crash Recovery & StatefulSet Volume Preservation** | | ✅ | |
| **Empirical Consistency Audit (Stale Read Rates)** | | ✅ | |
| **Cross-Project Experiment Orchestration** | | | ✅ |
| **Workload Compilation & Seed Derivation** | | | ✅ |
| **Fault Schedule Translation** | | | ✅ |
| **Metrics Normalization & Error Taxonomy Mapping** | | | ✅ |
| **Immutable Trace Lineage in S3** | | | ✅ |

---

## 3. Dedicated Repository & Directory Architecture

```text
/
├── blackbox-x/                   # Autonomous simulation & capacity platform (M0–M12)
│
├── quorum-lab/                   # Distributed consensus & consistency lab (Q0–Q11)
│
└── system-x/                     # Third Independent Integration Layer (I0–I8)
    ├── packages/
    │   ├── integration-contracts/  # Pure TypeScript types & schemas (no backend dependencies)
    │   ├── quorum-adapter/         # Client targeting Quorum Control API (REST) & Nodes (gRPC)
    │   ├── blackbox-adapter/       # Client targeting Blackbox API (REST)
    │   ├── workload-compiler/      # Translates Blackbox WorkloadSpec -> Quorum Workload
    │   ├── fault-compiler/         # Translates Virtual Faults -> Quorum Fault Timelines
    │   ├── result-normalizer/      # Maps latencies, throughput, and errors into MetricSample
    │   └── artifact-linker/        # Writes SHA-256 verified trace lineage into MinIO S3
    │
    ├── apps/
    │   └── integration-orchestrator/ # Fastify service executing closed-loop campaigns
    │
    ├── schemas/
    │   ├── experiment.schema.json
    │   ├── workload.schema.json
    │   ├── fault.schema.json
    │   └── result.schema.json
    │
    ├── scenarios/
    │   ├── quorum-leaderless.yaml
    │   ├── quorum-raft.yaml
    │   ├── quorum-partition-chaos.yaml
    │   └── quorum-hot-key-saturation.yaml
    │
    └── docs/
        ├── ARCHITECTURE.md
        ├── DATA_FLOW.md
        ├── CONTRACTS.md
        └── EXPERIMENTS.md
```

---

## 4. Canonical Cross-System Contracts

### 4.1. The Integrated Experiment Specification (`IntegratedExperiment`)
```typescript
export interface IntegratedExperiment {
  readonly integrationRunId: string; // Global UUID v4 linking both systems

  readonly blackbox: {
    readonly projectId: string;
    readonly topologyId: string;
    readonly workloadId: string;
    readonly simulationId?: string;
  };

  readonly quorum: {
    readonly projectId: string;
    readonly clusterId: string;
    readonly policySnapshotId: string;
  };

  readonly workload: {
    readonly operations: 'READ' | 'WRITE' | 'MIXED';
    readonly readRatio: number;   // e.g. 0.90 for read-heavy
    readonly writeRatio: number;  // e.g. 0.10
    readonly keySpace: number;     // e.g. 10000
    readonly distribution: 'UNIFORM' | 'ZIPFIAN';
    readonly zipfTheta?: number;  // default 0.99
    readonly concurrency: number; // e.g. 50 client workers
    readonly warmupMs: number;    // e.g. 10000 ms
    readonly measurementMs: number; // e.g. 60000 ms
  };

  readonly consistency: {
    readonly replicationEngine: 'LEADERLESS' | 'LEADER' | 'RAFT';
    readonly readConsistency: 'ONE' | 'QUORUM' | 'ALL' | 'SESSION' | 'CAUSAL';
    readonly writeAckPolicy: 'ONE' | 'QUORUM' | 'ALL';
    readonly durability: 'MEMORY_ONLY' | 'BATCHED_FSYNC' | 'SYNC_FSYNC';
    readonly conflictStrategy: 'LAST_WRITE_WINS' | 'VERSION_VECTOR' | 'MULTI_VALUE';
  };

  readonly faults: IntegratedFaultSchedule[];

  readonly slo: {
    readonly targetP99Ms: number;
    readonly maxErrorRate: number;
  };

  readonly seed: number; // Master seed
}

export interface IntegratedFaultSchedule {
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly faultType: 'PARTITION' | 'DELAY' | 'LOSS' | 'CLOCK_SKEW' | 'CRASH_RESTART';
  readonly targetNodes: readonly string[];
  readonly parameters?: Record<string, any>;
}
```

---

### 4.2. Normalized Metric Sample Schema (`MetricSample`)
Every metric emitted preserves its origin `source` to prevent conflating simulation with empirical observations:

```typescript
export interface MetricSample {
  readonly integrationRunId: string;
  readonly timestampUs: number;
  readonly source:
    | 'BLACKBOX_SIMULATION'
    | 'BLACKBOX_REAL'
    | 'QUORUM_NODE'
    | 'QUORUM_CLIENT';

  readonly metric:
    | 'LATENCY'
    | 'THROUGHPUT'
    | 'ERROR_RATE'
    | 'STALE_READ_RATE'
    | 'REPLICA_LAG'
    | 'QUEUE_DEPTH'
    | 'CPU_UTILIZATION'
    | 'CONNECTION_UTILIZATION'
    | 'REPAIR_RATE';

  readonly value: number;
  readonly unit: 'us' | 'ms' | 'ops_s' | 'ratio' | 'percent' | 'count';
  readonly tags?: Readonly<Record<string, string>>;
}
```

---

### 4.3. Semantic Outcome & Error Taxonomy Mapping
Internal error codes from QUORUM LAB are translated into high-level comparative failure categories:

| Native QUORUM Error Code | Category in SYSTEM-X | Comparative System Implication |
| :--- | :--- | :--- |
| `STATUS_CODE_FENCED` | `LEADERSHIP_SAFETY_FAILURE` | Stale leader write fenced by higher epoch |
| `NotLeaderError` | `ROUTING_RETRYABLE_FAILURE` | Client contacted follower in single-leader mode |
| `UnsafeLeaderError` | `COORDINATION_LEASE_EXPIRED` | Leader lease expired during external authority blip |
| `QuorumWriteError` | `WRITE_AVAILABILITY_FAILURE` | $W$ replica acks could not be gathered within timeout |
| `CausalConsistencyError` | `CONSISTENCY_REQUIREMENT_FAILURE` | Client causal dependency frontier unsatisfied |
| `STATUS_CODE_STALE_MEMBERSHIP` | `MEMBERSHIP_SAFETY_FAILURE` | Split-brain cluster configuration rejected |

---

## 5. The Deterministic Random Seed Derivation Rule

Both systems are deterministic, but they do NOT share RNG implementations.
A single master `experimentSeed` deterministically derives all sub-seeds using HMAC/SHA-256:

$$\text{subSeed} = \text{uint32}\Big(\text{SHA-256}\big(\text{integrationRunId} + \text{masterSeed} + \text{streamName}\big)\Big)$$

- `blackboxSeed` derived for virtual clock event calendar.
- `quorumWorkloadSeed` derived for key generator (`UniformGenerator` / `ZipfianGenerator`).
- `faultTimelineSeed` derived for failure injection jitter and node selection.

---

## 6. The Research Feedback Loop Walkthrough

```
  [1. MODEL]           [2. SIMULATE]             [3. COMPILE]              [4. EXECUTE]
  BLACKBOX-X  ──────>  BLACKBOX-X  ───────────>  SYSTEM-X  ─────────────>  QUORUM LAB
  Topology DAG         Virtual Event Engine      IntegratedExperiment      3-Node Real Cluster
  Workload Spec        Predicts p50/p95/p99      Seed & Fault Compilation  Real Quorum Mutations
                             │                                                   │
                             ▼                                                   ▼
                    Simulated Latencies                                 Empirical Latencies
                             │                                                   │
                             └─────────────────┬─────────────────────────────────┘
                                               ▼
                                         [5. COMPARE]
                                     Statistical Engine
                                    KS-Test & Wasserstein
                                               │
                                               ▼
                                         [6. CALIBRATE]
                                      Coordinate Descent
                                  Tunes Service Distributions
                                               │
                                               ▼
                                         [7. VALIDATE]
                                      Held-out Validation
                                   Certified System Model
```

1. **Model (BLACKBOX-X)**: User defines multi-tier topology graph representing client, gateway, and $N$ database replica nodes.
2. **Simulate (BLACKBOX-X)**: Discrete-event engine predicts throughput, p50, p95, p99 latencies, and queue depths under nominal and degraded states.
3. **Compile (SYSTEM-X)**: `WorkloadCompiler` and `FaultCompiler` generate the matching QUORUM LAB policy and execution plan.
4. **Execute (QUORUM LAB)**: Real cluster executes under live traffic with actual network faults injected at exact timeline offsets.
5. **Compare (SYSTEM-X / BLACKBOX-X)**: The Statistical Comparator runs the Two-Sample Kolmogorov-Smirnov test ($D_{KS}$) and Wasserstein distance between the simulated latency distribution and the empirical latency distribution.
6. **Calibrate (BLACKBOX-X)**: Coordinate-descent optimizer tunes simulated resource service times and queue capacities to minimize $D_{KS}$.
7. **Validate (SYSTEM-X)**: A held-out scenario is executed; if $D_{KS} \le 0.05$, the simulation model is formally certified as predictive.

---

## 7. The SYSTEM-X Integration Roadmap (I0–I8)

To complete the cross-system integration without reopening completed milestones:

| Milestone | Title | Scope & Key Deliverables |
| :--- | :--- | :--- |
| **I0** | Integration Foundation | `integration-contracts`, schemas (`experiment`, `workload`, `fault`, `result`), `integrationRunId`. |
| **I1** | QUORUM Target Adapter | REST client for Control API (`/v1/clusters`, `/policies`, `/runs`) & gRPC client for nodes. |
| **I2** | Workload Bridge | Compilation from Blackbox `WorkloadSpec` to Quorum `BenchmarkRunner` with SHA-256 derived seeds. |
| **I3** | Fault Bridge | Bi-directional translation between Blackbox virtual chaos and Quorum `FaultControlService`. |
| **I4** | Result Bridge & Normalization | Unified `MetricSample` streaming, error taxonomy mapping, and divergence metric collection. |
| **I5** | Simulation ↔ Real Comparison | Automated execution of Simulate $\rightarrow$ Measure $\rightarrow$ KS / Wasserstein statistical distance. |
| **I6** | Closed-Loop Calibration Loop | Real Quorum observations feed Blackbox optimizer to tune simulation parameters. |
| **I7** | Research Campaign Engine | Multi-dimensional Cartesian sweep across replication engines $\times$ consistency $\times$ faults. |
| **I8** | Integrated Certification Gate | End-to-end certification gate producing immutable S3 trace checkpoints with SHA-256 checksums. |
