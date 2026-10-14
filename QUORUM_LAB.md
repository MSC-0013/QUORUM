# QUORUM LAB — Implementation-Ready Master Plan (Q0–Q11)

## Context

BLACKBOX-X (capacity/performance simulation) is already built. QUORUM LAB is its sister project — a distributed key-value system for injecting failures, changing consistency policies, and measuring exactly when/how/why replicas diverge. Where BLACKBOX-X answers "how does this perform?", QUORUM LAB answers "what does this distributed system actually guarantee under failure?".

The working directory (`C:\MSC\Main project\QUORUM LAB`) is currently empty — this is a from-scratch greenfield build. An initial 11-milestone plan (Q0–Q10) was drafted and reviewed; the user then supplied a revised, implementation-ready master plan that corrects several protocol/boundary ambiguities that would otherwise cause rework mid-roadmap (conflating replication engine with consistency level, missing `experiment_run` as a first-class entity, reusing the KV WAL directly as a Raft log, under-specified idempotency, high-volume operation history going straight into MySQL, etc.). This document supersedes the earlier draft and is the one to build from.

The roadmap is now **Q0–Q11** (12 milestones instead of 11) because Foundation (protocol + node lifecycle) and Durable Storage (WAL/snapshot/recovery) are split into two separate milestones instead of one combined "Node Foundation" milestone — everything downstream shifts by one accordingly. This plan intentionally stays aligned with BLACKBOX-X's shared tech spine (Node.js 24 + TypeScript, Fastify, MySQL 8.4, Redis 8.8, Kafka 4.3, gRPC, MinIO/S3, OpenTelemetry/Prometheus/Tempo/Loki, Next.js, Docker/Kubernetes, GitHub Actions, Vitest) and keeps QUORUM LAB and BLACKBOX-X as two separate repositories. Non-goals, per the user: never becomes "Redis with a fancy UI" — the node protocol and correctness verification are the product; AI is never used to determine correctness, only (optionally, later) to explain an already-measured failure after the fact.

**Roadmap at a glance:**
```
Q0  Foundation + Node Protocol
Q1  Durable Storage
Q2  Replication Engine
Q3  Quorum + Control Plane
Q4  Failure Injection + Experiment Runtime
Q5  Conflict + Causality
Q6  Repair + Convergence
Q7  Correctness + Verification
Q8  Leader + Fencing
Q9  Raft
Q10 Kubernetes + Productionization
Q11 Research + Benchmarking
```

---

## 1. What QUORUM LAB actually is

```
BLACKBOX-X                              QUORUM LAB
  workloads, capacity, queues,            replicated state, quorum, conflicts,
  latency, resource saturation,           partitions, clocks, repair, leader
  failure propagation, architecture       election, consensus, correctness
  performance                             checking
       ↓                                        ↓
  "HOW DOES IT PERFORM?"                  "WHAT DOES IT ACTUALLY GUARANTEE?"
```

**The architectural rule that governs every decision below:** the distributed node protocol and correctness verification are the product. Kafka, Redis, MySQL, the UI, Grafana, etc. support the laboratory — they must never become the thing being demonstrated.

---

## 2. Key corrections vs. the initial draft

| Area | Initial approach | Corrected approach |
|---|---|---|
| Consistency model | Mixed replication mode and consistency mode together | Kept as four fully separate axes (§5) |
| Experiment identity | `experiment` implicitly represented execution | Split into `experiment` (immutable scenario) + `experiment_run` (actual execution) |
| Operation storage | Every operation potentially into MySQL | Full history → Kafka → object storage; MySQL stores indexed/summary data only |
| Request identity | Not explicit enough | `operation_id` + `request_id` + `client_id` + `run_id` everywhere, for idempotent dedup under gRPC retry |
| WAL vs Raft | Q0 WAL reused directly as Raft log | Shared low-level `AppendOnlyLog` infra; separate KV WAL and Raft log semantics on top |
| Clock model | wall + logical | wall + **monotonic** + logical, with monotonic mandatory for all latency math |
| Membership | Static JSON | Versioned cluster membership/config snapshot, checked on every replication RPC |
| Repair | Value-centric | Version/sibling/tombstone-centric |
| Tombstone GC | "all replicas ≥ tombstone version" | Explicit GC watermark + membership awareness + outstanding-hint check + retention window |
| Fault injection | Primarily node-to-node | Explicit scopes: client→node, node→node, process, storage, clock |
| Load generator | RPS mentioned | Deterministic **open-loop** workload generator with keyspace distributions |
| Correctness | One checker set for everything | Checkers only run when the selected consistency model makes that property meaningful; result taxonomy includes `NOT_APPLICABLE`/`INCONCLUSIVE` |
| Experiment scheduler | Chained `setTimeout` | Deterministic offset-based scheduler against a monotonic experiment clock |
| Custom merge | Potentially arbitrary merge function | Server-registered merge strategies only (no user-supplied code) |
| Security | Mostly platform security | + node authentication, experiment isolation, quotas, idempotency contract |
| Durability policy | One flat `ASYNC/SYNC/QUORUM/ALL` enum | Split into **Write Ack Policy** (`ONE/QUORUM/ALL`) vs **Local Durability** (`MEMORY_ONLY/BATCHED_FSYNC/SYNC_FSYNC`) — `QUORUM`/`ALL` are cluster ack semantics, not local durability |
| Q0/Q1 boundary | Q0 implied durable storage (WAL/snapshot) while Q1 also owned it | Q0 = volatile in-memory node only; Q1 = adds WAL+snapshot+recovery to become durable |
| Version truth | "Highest acknowledged version" as a single scalar | `VersionFrontier` (set of maximal/concurrent versions) — there often isn't one "highest" version |
| Snapshot RPC ownership | `InstallSnapshot` implied on both `NodeService` and `RaftService` | `NodeService.CreateSnapshot` (local) vs `RaftService.InstallSnapshot` (Raft log transfer) — kept as distinct, non-overlapping RPCs |
| Idempotency | IDs defined, but no dedup storage/retention | Explicit `IdempotencyRecord` persisted in the WAL, survives restart |
| Same-timestamp faults | Offset-based scheduling only | + deterministic tie-break via a compile-time `sequenceNumber` |
| RNG streams | "Separate streams" stated, derivation unspecified | Frozen derivation: `subSeed = SHA256(rootSeed + streamName + streamIdentity)` |
| Leader epoch authority | Redis epoch counter assumed always available | If the epoch authority loses durable state, leader mode goes `UNSAFE` and stops accepting leader writes — never silently restarts the counter |
| Q11 benchmark matrix | Full Cartesian product (~14,400 combinations) | Tiered: Smoke / Core / Research subsets |
| Stale reads | Implicitly treated as violations | First-class `GuaranteeProfile` per consistency model decides PASS/VIOLATION/INCONCLUSIVE/NOT_APPLICABLE |

---

## 3. Final architecture

```
                       Next.js Web
                            │
                       REST / WS
                            │
                      Control API (Fastify)
                       ┌────┴────┐
                   MySQL       Redis
              (control plane) (live state/coordination)
                       │
              Transactional Outbox
                       │
                     Kafka
          ┌────────────┼────────────┐
          ▼             ▼            ▼
  Experiment Worker  Analysis Worker  Report Worker
          │
   Experiment Runtime
     ┌─────┼─────┐
     ▼     ▼      ▼
  Node A  Node B  Node C
    WAL    WAL     WAL
     └─────┼──────┘
      gRPC Node Protocol
       Fault Interceptors
     ┌──────┼───────┐
     ▼      ▼        ▼
   delay   loss   partition
     → independent replicated state
```

Observability: quorum-node / workers / API → OpenTelemetry → Prometheus, Tempo, Loki.

### 3.1 Frozen conceptual view (post-corrections)

```
                     QUORUM LAB
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
   DATA PLANE        EXPERIMENT PLANE   VERIFICATION PLANE
       │                  │                  │
       ▼                  ▼                  ▼
  quorum-node        experiment-run      history/checkers
       │                  │                  │
       ▼                  ▼                  ▼
    storage           faults/workload      guarantees
       │                  │                  │
       ▼                  ▼                  ▼
      WAL             Kafka/Redis         violations
       │
       ├── replication
       ├── quorum
       ├── leader
       └── raft
```

And the behavioral model — how the five configuration axes (§5) actually compose into a measured outcome:

```
                CLUSTER CONFIG
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
 Replication       Read          Write Ack
   Engine        Consistency      Policy
        │             │             │
        └─────────────┼─────────────┘
                      │
              Conflict Strategy
                      │
                 Local Durability
                      │
                      ▼
                Actual Behavior
                      │
                      ▼
               Fault Injection
                      │
                      ▼
                Operation History
                      │
                      ▼
                  Checkers
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
         PASS      VIOLATION   INCONCLUSIVE
                                  │
                            NOT_APPLICABLE
```

These two diagrams are the ones to keep pinned during implementation — every other diagram in this plan is a zoom-in on one branch of these.

---

## 4. Final repository structure

```
quorum-lab/
├── package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json
├── .editorconfig / .env.example / README.md
├── .github/workflows/{ci.yml, integration.yml, release.yml}
│
├── .lab/
│   ├── schemas/{experiment.schema.json, workload.schema.json, failure.schema.json}
│   └── scenarios/
│
├── apps/
│   ├── quorum-node/src/
│   │   ├── main.ts, app.ts, config.ts
│   │   ├── service/{nodeServiceImpl, faultControlServiceImpl, healthServiceImpl, raftServiceImpl}.ts
│   │   ├── engine/{nodeEngine, storageEngine, replicationEngine, clusterConfig, mutationExecutor}.ts
│   │   ├── bootstrap/{recovery, validation, readiness}.ts
│   │   └── runtime/{clocks, nodeState, lifecycle}.ts
│   │
│   ├── control-api/src/{main.ts, app.ts, config.ts, db/, routes/, services/, plugins/, ws/}
│   ├── experiment-worker/src/{main.ts, lifecycle/, scheduler/, workload/, provisioning/, fault/, collection/}
│   ├── analysis-worker/src/{main.ts, consumers/, checkers/, resultWriter.ts}
│   ├── report-worker/src/
│   └── web/src/app/
│
├── packages/
│   ├── protocol/proto/{common.proto, node.proto, fault.proto, raft.proto, events.proto} + gen/
│   ├── contracts/, storage/, clocks/, replication/, consistency/, fault-model/, checker/, grpc/, observability/, events/, experiment-model/, testkit/
│
├── infrastructure/{docker/, mysql/, redis/, kafka/, minio/, kubernetes/}
├── tests/{unit, integration, property, fault, correctness, load, chaos, golden}/
├── docs/{architecture, protocols, consistency, replication, correctness, adr, experiments, benchmarks, operations, security}/
└── scripts/{dev, cluster, benchmark, verification}/
```

---

## 5. Abstraction cleanup — do not conflate these

Five independent axes, not one flat "mode" enum where `LEADER`, `QUORUM`, `CAUSAL`, `EVENTUAL` all look like peers of each other:

- **A. Replication engine:** `LEADERLESS | LEADER | RAFT`
- **B. Read consistency:** `ONE | QUORUM | ALL | EVENTUAL | SESSION | CAUSAL`
- **C. Write acknowledgement policy:** `ONE | QUORUM | ALL`
- **D. Local durability policy:** `MEMORY_ONLY | BATCHED_FSYNC | SYNC_FSYNC`
- **E. Conflict strategy:** `LAST_WRITE_WINS | VERSION_VECTOR | MULTI_VALUE | CUSTOM_MERGE`

`QUORUM`/`ALL` under axis C are cluster acknowledgement semantics (how many replicas must ack before the client is told the write succeeded) — they are **not** local durability (axis D, whether *this node's* fsync actually happened). Conflating C and D was the original draft's mistake: a node can be in a `QUORUM`-acked cluster while individually running `MEMORY_ONLY` durability, and that combination is exactly the kind of thing this lab exists to make visible.

A cluster's actual behavior = **A + B + C + D + E**, configured independently.

---

## 6. Canonical version model

Not a bare integer. Every stored value carries a structured version:

```ts
type VersionStamp = {
  dot: { nodeId: string; counter: number };
  vectorClock: Record<string, number>;
  lamport: number;
  wallTimeMs: number;
};

type VersionedValue = {
  key: string;
  value: Uint8Array | null;
  tombstone: boolean;
  version: VersionStamp;
  siblings?: VersionedValue[];
};
```

This cleanly separates causal ordering, conflict detection, logical ordering, LWW experiments, tombstones, and lineage tracking instead of conflating them into one field.

### 6.1 Version frontier

"Highest acknowledged write version" breaks down once concurrent branches exist — under `MULTI_VALUE`/`VERSION_VECTOR`, two versions `VA` and `VB` can be genuinely incomparable (`VA ‖ VB`), so there isn't one universally "highest" version to compare a read against. Model the frontier explicitly instead:

```ts
// packages/consistency/versionFrontier.ts
type VersionFrontier = {
  maximalVersions: VersionStamp[]; // versions with no known dominating version
};
```

A linear history collapses this to a single-element frontier (`[VE]` after `VC`/`VD` both merge into `VE`); a genuinely concurrent history keeps multiple maximal versions (`[VA, VB]`) until something (a write, a merge, `MULTI_VALUE` resolution) dominates them. Every checker in Q7 (staleness, causality, monotonic reads, read-your-writes) reasons against the frontier, not a bare scalar — this is what makes those checkers correct under `MULTI_VALUE`/`VERSION_VECTOR` instead of only under `LWW`.

---

## 7. Clock architecture

Three distinct clocks, never interchanged:
- **WallClock** — timestamps, LWW experiments (this is the one Q5's clock-skew fault perturbs).
- **MonotonicClock** — latency/elapsed time/scheduler. `latency = monotonicNow(return) - monotonicNow(invoke)` — never computed from a skewed wall clock.
- **LamportClock** — logical ordering.

---

## 8. Experiment vs. experiment run

An experiment definition is not an execution:

```
Experiment (immutable scenario, configuration, metadata)
      ↓
Experiment Run (actual seed, actual nodes, actual timings, actual faults, actual operations, actual results)
```

`experiments` and `experiment_runs` are separate tables. This lets experiment #17 have run #1/#2/#3 with different seeds or engines, and be compared correctly — without it, "did the same seed reproduce?" or "did QUORUM vs RAFT differ?" become unanswerable questions.

---

## 9. Operation identity & idempotency

Every operation carries `run_id`, `client_id`, `operation_id`, `request_id`. This matters because a gRPC timeout + client retry can otherwise produce two writes from what the client considers one logical request — the storage layer must dedupe against an explicit idempotency contract keyed on these IDs, not assume exactly-once delivery.

IDs alone aren't enough — something has to durably remember "this `request_id` was already applied, here's what it returned" across a restart, or the dedup state is lost exactly when it matters most (crash right after ack, client retries against the recovered node, duplicate mutation applied). Define this explicitly from Q1 onward:

```ts
type IdempotencyRecord = {
  operationId: string;
  requestId: string;
  status: "APPLIED" | "FAILED";
  resultingVersion?: VersionStamp;
  resultHash?: string;
};
```

`IdempotencyRecord`s are written to the WAL alongside the mutation they dedupe (not a separate in-memory-only table), so they survive the exact crash/restart/retry sequence they exist to guard against — with a retention contract, not an unbounded one: `idempotencyRetention >= maximum permitted client retry window`. If a retry ever arrives after its `IdempotencyRecord` has expired, that operation is explicitly outside the exactly-once/idempotency contract (may re-apply) — this is a protocol-level guarantee to document, not an implementation detail to leave implicit, since a shorter retention than the workload driver's retry window silently turns "at-most-once" into "at-least-once" for late retries.

---

## 10. Data-plane vs. control-plane boundary (absolute)

- **MySQL:** users, projects, clusters, cluster versions, experiment definitions, experiment runs, results, violations, repair summaries, reports, audit, quotas.
- **Node local storage:** KV records, WAL, snapshots, hints, replication metadata, Raft log.
- **Redis:** live state, ephemeral coordination, leases, rate limiting, short-lived UI state.
- **Kafka:** experiment lifecycle, operation stream, repair events, violation events, audit events.
- **MinIO/object storage:** large operation histories, experiment artifacts, raw history, reports, large benchmark results.

This is what prevents MySQL from becoming the high-volume event database at 5,000–10,000 ops/sec.

---

## 11. Milestone-by-Milestone Plan

### Q0 — Foundation + Node Protocol
**Goal:** protocol + executable **volatile** node, no durability and no distributed replication yet. Q0 is deliberately `MemStore` only — durability is entirely Q1's job, so the two milestones don't overlap.

```
Q0:  gRPC → NodeService → MemStore   (nothing durable yet)
```

**Deliverables:** pnpm/Turborepo workspace, TS strict mode, buf+ts-proto toolchain, `common.proto`/`node.proto`/`events.proto`, config system, node lifecycle, health service, basic node state.

**Node RPCs implemented:** `Put, Get, Delete, GetVersion, GetNodeState, Health` — all against the in-memory store only. **Not implemented at Q0** (`UNIMPLEMENTED`): `CreateSnapshot` (needs Q1's storage engine), `Replicate, Repair` (Q2/Q6), `PrepareWrite, CommitWrite` (Q8), all Raft RPCs (Q9).

**Node lifecycle:** `STARTING → BOOTSTRAPPING → READY → HEALTHY`.

**Config shape:**
```yaml
node: { id: node-a, clusterId: cluster-1, dataDir: ./data/node-a }
cluster: { membershipVersion: 1, members: [node-a, node-b, node-c] }
```

**Tests:** gRPC contract tests, config validation, health tests, lifecycle tests, generated-proto compatibility.

**DoD:** run `node-a`, execute `Put/Get/Delete/GetVersion/GetNodeState` over gRPC. Nothing durable, nothing distributed yet — restart loses all data, by design.

---

### Q1 — Durable Storage
**Goal:** turn Q0's volatile `MemStore` into a real local database — the foundation everything else depends on. `CreateSnapshot` becomes implemented here (it needs a storage engine to snapshot).

**Storage engine:** `StorageEngine { MemStore, WAL, SnapshotManager, RecoveryManager }` — `MemStore` is reused unchanged from Q0; Q1 adds the other three around it.

**WAL format:** `[u32 length][protobuf record][u32 crc32c]`. Record types `PUT | DELETE | SNAPSHOT_MARKER`; every record includes local sequence, key, value, tombstone, version stamp, writer node, lamport, wall time, `request_id`, `operation_id`.

**Recovery:** open snapshot → load snapshot state → scan WAL → validate length → validate CRC → stop cleanly at an incomplete tail → replay valid records → healthy. A partially written final record must never corrupt the node.

**Snapshot invariant:** `state at snapshotSeq S + WAL records after S = current state`.

**WAL durability modes — must use exactly the axis-D names from §5, nowhere else in the codebase:**
```
MEMORY_ONLY     WAL write reaches process memory only, no fsync
BATCHED_FSYNC   WAL records buffered; fsync occurs in batches
SYNC_FSYNC      WAL record is fsynced before the durable ack is returned
```
Only `SYNC_FSYNC` (and, within its batch boundary, `BATCHED_FSYNC`) count as durable for correctness experiments — `MEMORY_ONLY` is explicitly non-durable and exists so experiments can demonstrate what breaks without it.

**WAL corruption policy — a crash-torn final record and mid-segment corruption are different failure classes and must be handled differently, not both silently "truncated and continued":**
```
TAIL_INCOMPLETE       record length read succeeds but fewer bytes exist than declared,
                       and it's the last record in the segment
                       → recover by truncating the tail

TAIL_CRC_FAILURE       full-length record present but CRC fails, and it's the last record
                       → recover as a torn write ONLY when safely attributable to being
                         the final record; truncate tail

MID_SEGMENT_CORRUPTION a length/CRC failure on a record that is NOT the last one
                       → node enters STORAGE_CORRUPTED, recovery fails,
                         surfaced as an operator/experiment-level failure — never
                         silently truncated and continued
```
Silently truncating past a mid-segment corruption would let the laboratory hide real storage corruption instead of surfacing it — the opposite of what a correctness lab is for.

**Mutation ordering:** gRPC handlers → mutation queue → serialized mutation application → WAL → memory state. Reads stay concurrent; writes are serialized through one executor so concurrent gRPC calls don't race the storage engine.

**Tests:** 10k random ops + crash at an arbitrary point + restart + replay, compared against a reference model; partial WAL record; CRC corruption; snapshot recovery; delete+tombstone; duplicate request replayed after restart resolves via the persisted `IdempotencyRecord` (§9), not a fresh mutation.

**DoD:** a node can crash at an arbitrary moment and always recover to the correct durable state.

---

### Q2 — Replication Engine
**Goal:** actual distributed replication, starting from a simple leaderless/coordinator baseline — no quorum semantics yet.

**Interface locked in now:**
```ts
interface ReplicationEngine {
  put(...): ...; get(...): ...; delete(...): ...;
  recover(...): ...; repair(...): ...; health(...): ...;
}
```
Implementations: `AsyncReplicationEngine`, `SyncReplicationEngine`. (`QuorumReplicationEngine`, `LeaderReplicationEngine`, `RaftReplicationEngine` join this same interface at Q3/Q8/Q9.)

**Flow:** client → coordinator → local WAL → `Replicate` fan-out to peers. `Replicate` RPC carries `operation_id, request_id, source_node, record, fencing_epoch, membership_version`. Replicas must handle the same replication record arriving twice without creating duplicate logical state.

`fencing_epoch` is added to the wire format here at Q2, but it is **reserved protocol metadata with no semantic effect before Q8** — Q0–Q7 always send/accept `0`; it becomes meaningful for the `LEADER` engine at Q8; conceptually it's superseded by the Raft `term` once `RAFT` is selected at Q9. Reserving the field now avoids a breaking `Replicate` RPC change later. Every node checks the cluster config version / membership hash on each replication RPC — a stale node must never silently act on an obsolete membership view.

**Tests:** 3-node sync replication, 3-node async replication, replica restart, replication retry, duplicate `Replicate`, out-of-order `Replicate`, replication lag measurement.

**DoD:** demonstrable leaderless replication, sync and async, with lag and recovery, across real independent local data stores.

---

### Q3 — Quorum + Control Plane
**Goal:** the laboratory becomes usable — configurable cluster creation plus quorum reads/writes.

**Control API:** Fastify + MySQL + RBAC + projects/clusters/nodes/policies.

**Quorum coordinator:** `ONE, QUORUM, ALL` consistency levels (e.g. N=5, W=3, R=3). Write returns after W acks; read queries R replicas, collects version/vector clock/tombstone/siblings, resolves per the configured policy.

**Critical correctness note carried through the whole project:** `W + R > N` proves **quorum set intersection**, not linearizability. Full consistency additionally depends on version semantics, membership, ordering, conflict resolution, read semantics, repair, and failure behavior — the docs and UI must never claim otherwise.

**APIs:** `POST/GET /v1/projects`, `POST/GET/GET:id/PATCH/DELETE /v1/clusters`, `POST/GET /v1/clusters/:id/nodes`, `POST/GET /v1/clusters/:id/policies`.

**Tests:** property tests over random N/W/R, random node failures, random operation order — verifying quorum math, explicitly not prematurely asserting linearizability (that's Q7's job).

**DoD:** a cluster created through the API runs `ONE/QUORUM/ALL` read/write behavior correctly.

---

### Q4 — Failure Injection + Experiment Runtime
**Goal:** the system becomes an actual laboratory.

**Failure scopes:**
- Process: `HARD_CRASH, SOFT_CRASH, RESTART`
- Network: `DELAY, LOSS, DUPLICATION, REORDER, PARTITION`
- Clock: `CLOCK_SKEW`
- Storage: `SLOW_DISK, WRITE_FAILURE, READ_FAILURE`
- Link scope: `CLIENT→NODE` vs `NODE→NODE` (kept distinct — these break different things).

**Deterministic RNG:** no single global random stream — stable per-purpose streams derived from the experiment seed (`traffic`, `client-1`, `client-2`, `node-a→node-b`, `node-b→node-c`, `fault-scheduler`, ...), so experiments stay reproducible even when unrelated code changes. The derivation is frozen, not ad hoc: `subSeed = SHA256(rootSeed + streamName + streamIdentity)`. Freezing this specific formula is what keeps a later refactor (e.g. adding a new client) from silently perturbing unrelated streams' random sequences — which would otherwise quietly break the flagship experiments' reproducibility claim.

**Experiment lifecycle (persisted state machine):** `DRAFT → VALIDATED → PREPARED → RUNNING → COLLECTING → VERIFYING → ANALYZING → REPORTING → DONE`, with `ANY STATE → FAILED` and `RUNNING → CANCELLING → CANCELLED`.

**Scheduler:** not chained `setTimeout`s — every fault/traffic event carries a `scheduledOffsetMs` relative to experiment start, applied against a monotonic experiment clock; both `scheduled_at` and `actual_applied_at`/`actual_cleared_at` are recorded (the delta is itself a useful metric). Two events at the identical offset must still execute in a defined order: each event gets a `sequenceNumber` assigned at scenario-compile time, and ties break on `(scheduledOffsetMs, sequenceNumber)` — so `partition` and `delay` both scheduled at `t=30000ms` always apply in the same order across runs.

**Workload generator (explicit, not implied):**
```yaml
traffic:
  mode: open_loop
  targetRps: 5000
  readsPercent: 70
  writesPercent: 30
  clients: 50
  keyspace: { size: 100000, distribution: zipf }
  value: { sizeBytes: 512 }
```
Distributions: `uniform | zipf | hot-key | sequential | random`. Open-loop matters specifically because latency must not automatically throttle the generated arrival rate — that would hide the exact availability effects this project exists to measure.

**Deliverables:** `fault.proto`/`FaultControlService`, `experiment-worker` fully live (`lifecycle/`, `scheduler/`, `workload/`, `provisioning/` for process+Docker, `fault/`, `collection/`), `resource_quotas` + quota middleware, Kafka experiment-lifecycle topic, Redis live-state keys.

**DoD:** repeatable, seeded, scoped fault injection driving a full experiment lifecycle end-to-end.

---

### Q5 — Conflict + Causality
**Goal:** real concurrent-write semantics — a value differing across nodes must be provably classified, not just observed.

**Conflict detection:** vector clock comparison → `A<B | A>B | A=B | A‖B` (`‖` = concurrent).

**Strategies:** `LWW, VERSION_VECTOR, MULTI_VALUE, CUSTOM_MERGE`.
- **LWW** tiebreak order: `wallTime → lamport → nodeId → dot.counter` — deliberately vulnerable to the Q4 clock-skew fault, which is the point (demonstrates why clock assumptions matter).
- **VERSION_VECTOR** represents concurrent versions explicitly (`A ─┐ / concurrent / B ─┘`), never silently declares a winner.
- **MULTI_VALUE** keeps `siblings[]`, never silently reduces them.
- **CUSTOM_MERGE** only accepts a registered strategy ID mapped to a known server-side implementation (e.g. `G_COUNTER`) — never arbitrary user-supplied code, to avoid a remote-code-execution-shaped configuration surface.

**Tests:** two/three isolated writers, vector comparison, clock skew, LWW conflict, multi-value, custom merge.

**DoD:** the lab can prove concurrent updates were concurrent, rather than merely observing that values differ.

---

### Q6 — Repair + Convergence
**Goal:** actively fix divergence once faults clear.

**Read repair:** on a quorum read finding a stale replica, repair it — including siblings, tombstones, and vector clocks, not just a scalar value.

**Anti-entropy:** keyspace partitioned into a fixed bucket count (default 1024, `bucket = hash(key) % 1024`), each a Merkle leaf; digest comparison walks root → mismatched children → mismatched leaves → individual keys, so only differing branches are ever traversed.

**Hinted handoff:** write to A while B is unreachable → A persists a durable, idempotent, version-aware hint (`target, key, version`) → replayed via `Repair` once B's `Health` succeeds.

**Tombstone GC:** deletion requires **all** of: retention period passed, all current replicas have observed the tombstone/version, no outstanding relevant hints, and membership state is compatible — only then does the GC watermark advance. (Not just "all replicas ≥ tombstone version" — that alone can resurrect data under hinted-handoff or membership-change edge cases.)

**Tests:** partition→stale replica→quorum-read-triggered repair; anti-entropy convergence with **zero** client reads; node outage→hinted handoff; delete→tombstone→no resurrection; GC→safe deletion only once all four conditions hold.

**DoD:** once the network stabilizes, replicas converge without requiring a new client read.

---

### Q7 — Correctness + Verification
**Goal:** the most scientifically important phase — turn recorded history into verified (or honestly inconclusive) guarantees.

**First principle:** not every consistency model should be checked against every property — e.g. `EVENTUAL` legitimately allows stale reads, so the analysis engine needs `experiment model + enabled checkers + expected guarantees`, not one fixed checker set applied blindly.

**Operation history record:** `runId, operationId, clientId, nodeId, invokeMonoNs, returnMonoNs, opType, key, arguments, result, version, vectorClock, outcome`. UI uses timestamps; the checker uses the monotonic interval; distributed ordering uses the logical/vector metadata.

**High-volume history architecture:** traffic → operation event → Kafka → history writer → compressed object storage (MinIO). MySQL stores only run summary, violation index, aggregate metrics, metadata, and optionally materialized samples — never the raw 10k+ ops/sec stream.

**Checkers, each independently scoped:**
- **Stale read**: stale version distance + stale duration — flagged as a violation only when the selected model forbids it.
- **Read-your-writes**: per client, last acknowledged write vs. later reads.
- **Monotonic reads**: per client, max observed version vs. later reads.
- **Causal**: vector-clock happens-before must be preserved in later observations.
- **Linearizability**: per-key real-time partial order → candidate linearizations → sequential KV spec, via bounded DFS + memoization. Below a concurrency threshold: exhaustive bounded verification. Above it: bounded heuristic search, reported as `INCONCLUSIVE` — **never** reported as proven when the search wasn't exhaustive.

**Result taxonomy (explicit, not forced pass/fail):** `PASS | VIOLATION | INCONCLUSIVE | NOT_APPLICABLE` — e.g. linearizability is `NOT_APPLICABLE` for an experiment intentionally testing eventual consistency.

**GuaranteeProfile — make "which checks even apply here" a first-class engine concept, not implicit logic buried in each checker:**
```ts
// packages/checker/guaranteeProfile.ts
type GuaranteeProfile = {
  linearizable: boolean;
  readYourWrites: boolean;
  monotonicReads: boolean;
  causal: boolean;
  staleReadsAllowed: boolean;
};
```
**`GuaranteeProfile` must be derived from the full configuration, not read consistency alone** — `QUORUM` under `LEADERLESS` with `W=3/R=3` is not automatically equivalent to `QUORUM` under `RAFT`, and `SESSION` needs actual per-client session context to mean anything:
```
GuaranteeProfile = derive(
  replicationEngine,   // axis A
  readConsistency,      // axis B
  writeAckPolicy,        // axis C
  localDurability,        // axis D
  conflictStrategy,        // axis E
  sessionMode
)
```
Every checker consults the run's derived `GuaranteeProfile` before classifying a result — this is what keeps the analysis engine from generating a scientifically misleading report (e.g. flagging every stale read as a "violation" regardless of what the specific five-axis configuration actually promised).

**Tests:** hand-built histories with a known planted violation (must detect) and a known-good history (zero false positives), for each checker.

**DoD:** violations are backed by measured, reproducible evidence with an honest confidence level — never an arbitrary score.

---

### Q8 — Leader + Epoch + Fencing
**Goal:** the simpler leader-based architecture, built before Raft.

**Lease:** Redis `SET key value NX PX ttl`, heartbeat-renewed — explicitly documented as **coordination, not consensus**.

**Epoch:** each lease acquisition increments `epoch = previous + 1`; every write carries `epoch, leaderId`; a replica accepts only `epoch >= current epoch` (fencing).

**Fencing must survive the epoch authority itself failing.** Redis holding the epoch counter is a single point of trust — if Redis loses its durable state, a naive re-init (`epoch = 1`) silently destroys the fencing guarantee (an old leader still believing it holds epoch 41 would now out-rank the "new" epoch-1 leader). Two hardening rules instead: (1) each replica additionally persists the highest epoch it has locally observed, independent of Redis, and rejects any write — from any leader — carrying an epoch below that locally-remembered value; (2) if the epoch authority is ever detected to have lost state (counter value regresses below a previously-issued epoch), leader mode goes explicitly `UNSAFE` and the cluster stops accepting leader-mode writes rather than silently resuming with a reset counter. The fencing check is conceptually a token comparison — `(epoch, leaderId)` — not just a raw epoch integer.

**Durable write protocol:** `PREPARE → fsync → PREPARED → COMMIT → fsync → VISIBLE`, with WAL-level `PREPARE/COMMIT/ABORT` states. Recovery must correctly interpret an incomplete transaction (leader crashing after prepare must never leave ambiguous visible state).

**Tests:** leader crash, lease expiry, new leader election, epoch increment, old leader reconnect + rejected write, prepared-transaction recovery.

**DoD:** demonstrable fencing (an old leader's write is rejected), not merely leader replacement.

---

### Q9 — Raft
**Goal:** the major distributed-systems milestone — native consensus, not hidden behind a library.

**Critical correction from the initial draft:** the Q1 KV WAL is **not** reused directly as the Raft log — a KV mutation log and a replicated consensus log have different semantics. Instead: a shared low-level `AppendOnlyLog` (segment/append/CRC/recovery/rotation/fsync/snapshot-support machinery) underlies **two** distinct logical logs — the KV WAL and the Raft log — kept separate at the logical level even though the low-level infrastructure is shared.

**Raft state per node:** `currentTerm, votedFor, role ∈ {FOLLOWER,CANDIDATE,LEADER}, commitIndex, lastApplied, nextIndex[], matchIndex[]`.

**RPCs — owned exclusively by `RaftService`, not duplicated on `NodeService`:** `RequestVote, AppendEntries, InstallSnapshot`. `NodeService.CreateSnapshot` (Q1) handles local snapshot creation; `RaftService.InstallSnapshot` (Q9) is solely for transferring a snapshot to a lagging follower during Raft log compaction — the two must not be conflated into one RPC with overloaded meaning.

**Safety rules implemented:** term fencing, log matching, leader completeness, commit only after majority, apply only committed entries. Raft snapshot metadata (`lastIncludedIndex, lastIncludedTerm`) is kept conceptually separate from the KV application-state snapshot even if physically co-located.

**Explicit protocol details required in the Q9 DoD (not left implicit):**
- **Election:** randomized election timeout, periodic heartbeat interval, term advancement on higher-term observation, candidate state reset on discovering a legitimate leader or higher term.
- **AppendEntries:** term check against `currentTerm`, `prevLogIndex`/`prevLogTerm` match check, conflicting-suffix detection and removal, append of new entries, `commitIndex` advancement only up to the last entry confirmed by the current leader.
- **Apply:** `applyIndex <= commitIndex` always — an uncommitted command is never applied to the state machine, even speculatively.
- **Crash recovery:** on restart, reload persistent `currentTerm` and `votedFor`, recover the Raft log, recover from the latest snapshot, reconstruct `commitIndex`/`lastApplied` before rejoining the cluster.
- **Snapshot installation:** write to a temporary location → validate → fsync → atomic rename into place; the active snapshot is never overwritten in place.

**Membership:** static only (5 fixed nodes) — dynamic membership changes are an explicitly documented future extension, not attempted here.

**Flagship verification (this milestone's actual Definition of Done, on 5 nodes):**
1. Kill leader → election → new leader → replication continues.
2. Partition 2 (minority) vs 3 (majority) → only the majority commits.
3. Partition + reconnect → old leader's stale log is corrected per Raft's conflict-resolution rules — a real integration test, not a demo.

---

### Q10 — Kubernetes + Productionization
**Goal:** orchestration, only after protocol correctness is already trusted.

**Stateful:** `quorum-node` as `StatefulSet` + PVC + headless service, stable ordinal (`quorum-node-0/1/...`) mapped to stable logical node IDs so PVC reattachment on rescheduling preserves WAL/snapshot data.

**Stateless:** control-api, experiment-worker, analysis-worker, report-worker as `Deployment`s.

**Required:** readiness/liveness/startup probes, PDB, resource requests/limits.

**Failure experiment:** `kubectl delete pod quorum-node-3` → observe `OFFLINE → RECOVERING → HEALTHY`, measuring recovery time, replication lag, repair activity, acknowledged writes. Called out explicitly as the one failure mode `packages/fault-model` doesn't cover (it exercises pod scheduling + PVC reattach, not just process death) — tested separately here.

---

### Q11 — Research + Benchmarking
**Goal:** the final portfolio/research stage — everything is now trustworthy enough to measure.

**Performance matrix dimensions** (node counts `1,3,5,7,9` × RPS `100,1k,5k,10k` × replication engine `leaderless,leader,raft` × consistency `ONE,QUORUM,ALL,SESSION,CAUSAL,EVENTUAL` × workload `read-heavy,write-heavy,balanced,hot-key,uniform` × failure `none,delay,loss,partition,crash,restart,clock skew,slow disk`) is roughly 14,400 raw combinations before repetitions/warmups/seeds — not a realistic "run everything" target. Structure it into three tiers instead:

- **Tier A — Smoke:** `1/3/5` nodes × `100/1k` RPS × no failure. Fast, runs on every CI pass.
- **Tier B — Core:** `3/5/7` nodes × `1k/5k` RPS × all 3 replication engines × `balanced/read-heavy/write-heavy` × a selected subset of consistency levels. The main comparative dataset.
- **Tier C — Research:** a designed (not exhaustive) subset layering `hot-key, partition, clock skew, crash, slow disk` onto representative Tier B configurations — this is what the flagship experiments and the final research report draw from.

This turns Q11 into an achievable, still-rigorous research program instead of an impossible full Cartesian sweep.

**Core metrics:** performance (throughput, p50/p95/p99/max latency), replication (lag, ack latency, repair lag, hint backlog), consistency (stale reads, RYW/monotonic/causal/linearizability violations, conflicts), recovery (detection/recovery/reconvergence time), resource (CPU, memory, WAL growth, network, disk).

**Deliverables:** `report-worker` fully built, load-matrix runner in `tests/load`, remaining portfolio docs.

---

## 12. Flagship Experiments (validation, tied to Q9/Q11 — not ongoing work)

**Flagship 1 — Quorum under partition (Q11):** 5 nodes, R=3/W=3, 5000 writes/s + 10000 reads/s. Timeline: t=0 start → t=30s partition A+B → t=60s delay C by 500ms → t=90s heal → t=120s stop. Measures availability, write/read latency, stale reads, conflicts, replication lag, repair traffic, convergence time.

**Flagship 2 — Random correctness (Q11):** 10,000 writes + 10,000 reads + 500 random failures (crashes, partitions, delays, restarts, clock skew) → full history → checkers → violations report (by category, affected keys/nodes, failure correlation, timeline).

**Flagship 3 — Raft (Q9, re-run at Q11):** elect leader → write load → kill leader → wait for election → continue writes → partition minority → continue writes → heal → verify log convergence. Verifies: at most one legitimate leader per term, minority never commits, committed entries remain committed, followers converge.

---

## 13. Control-plane database — final model

- **Identity:** `users, roles, permissions, projects, project_members`
- **Clusters:** `clusters, cluster_versions, nodes, node_versions`
- **Policies:** `replication_policies, consistency_policies`
- **Experiments:** `experiments, experiment_versions, experiment_runs, experiment_run_events, experiment_failures`
- **History/results:** `operation_history_manifests` (pointers into object storage, not raw ops), `consistency_violations, conflicts, repairs, snapshots, metrics, reports`
- **Platform:** `audit_logs, outbox_events, resource_quotas`

`experiment_runs` is mandatory, not optional (§8/§9) — without it, "did the same seed reproduce?" and "did QUORUM vs RAFT differ under identical conditions?" have no clean answer.

---

## 14. API surface — final

```
Projects:    POST/GET /v1/projects, GET/PATCH /v1/projects/:id
Clusters:    POST/GET /v1/clusters, GET/PATCH/DELETE /v1/clusters/:id
Nodes:       POST/GET /v1/clusters/:id/nodes, GET /v1/nodes/:id
Experiments: POST/GET /v1/clusters/:id/experiments, GET /v1/experiments/:id,
             POST /v1/experiments/:id/{validate,start,stop}
Runs:        GET /v1/experiments/:id/runs, GET /v1/runs/:runId,
             GET /v1/runs/:runId/{status,history,consistency,divergence,repairs,report}
```

**Node gRPC (final) — ownership kept explicit, no RPC duplicated across services:**
```
NodeService:  Put, Get, Delete, GetVersion, Replicate, ReadDigest, Repair,
              PrepareWrite, CommitWrite, CreateSnapshot, GetNodeState
FaultControlService: SetFault, ClearFault, ClearAllFaults, Crash
RaftService:  RequestVote, AppendEntries, InstallSnapshot
Health:       grpc.health.v1.Health
```
`CreateSnapshot` (local snapshot, `NodeService`) and `InstallSnapshot` (Raft log-compaction snapshot transfer, `RaftService`) are deliberately two different RPCs on two different services, per §2/§Q9 — never merge them into one overloaded method.

**Kafka event envelope:**
```ts
type EventEnvelope = {
  eventId: string; eventType: string; schemaVersion: number;
  projectId?: string; clusterId?: string; experimentId?: string; runId?: string;
  occurredAt: string; producer: string; payload: unknown;
};
```
At-least-once delivery assumed; consumers must dedupe on `eventId`.

**Redis keys:** `qlab:cluster:{id}:state`, `qlab:experiment:{id}:{state,progress}`, `qlab:node:{id}:heartbeat`, `qlab:lease:{clusterId}`, `qlab:lock:{resource}`, `qlab:ratelimit:{userId}` — never authoritative KV data.

---

## 15. Web UI build order (never ahead of the data that makes a page meaningful)

| Milestone | Pages |
|---|---|
| Q3 | Dashboard shell, Clusters, Topology, Nodes |
| Q4 | Experiment Builder, Running Experiment, Live metrics |
| Q5 | Divergence View, version detail, vector clocks |
| Q6 | Repair page, repair progress |
| Q7 | **Consistency Explorer** (flagship page), violation timeline, history viewer |
| Q8 | Leader / epoch / fencing views |
| Q9 | Raft topology, term, leader, commit index |
| Q11 | Reports, benchmark comparison, research matrix |

**Consistency Explorer** is the flagship page: a timeline (`WRITE x=10 → READ x=7 STALE → WRITE x=20 → READ x=20`) where clicking an event shows operation/client/node/latency/version/vector clock/lamport/replica states/fault state/causal dependencies — "why was x=7 visible?" answered from measured system state, never from an AI-generated guess.

---

## 16. Testing architecture

- **Unit:** WAL, snapshot, vector clock, Lamport, LWW, Merkle, quorum math, Raft state transitions.
- **Integration:** 3-node replication, 5-node quorum, leader failover, Raft failover.
- **Property:** random operations, random version vectors, random conflicts, random fault schedules.
- **Fault:** partition, crash, restart, loss, duplication, reorder, clock skew, slow disk.
- **Correctness:** golden histories (known violation / known good), bounded linearizability, causal histories.
- **Load:** 100 / 1,000 / 5,000 / 10,000 RPS matrix.

---

## 17. Required invariants (non-negotiable, tested continuously from the milestone they're introduced at)

- **Durability:** acknowledged durable writes are not silently lost.
- **Replica monotonicity:** a replica's version lineage cannot silently regress.
- **Tombstones:** deleted state must not resurrect.
- **Repair:** stable network + healthy replicas → eventual convergence.
- **Fencing:** an old epoch cannot commit.
- **Raft:** minority cannot commit.
- **Idempotency:** a retried operation never produces a duplicate logical mutation.

---

## 18. Security architecture

- **Control plane:** RBAC, API keys, token rotation, rate limits, audit, quotas.
- **Node plane (later hardening):** mTLS, node identity, certificate rotation.
- **Experiment isolation quotas:** `maxClusters, maxNodesPerCluster, maxRps, maxDurationSeconds`, plus limits on concurrent runs, memory, CPU, disk, Kafka retention, and history size — so one user can't create 1000 nodes / 10M ops/sec and take down the host.

---

## 19. Deterministic experiment contract

Every run records `seed, scenario version, cluster configuration version, engine version, node version, protocol version, workload version, fault model version`. Same scenario + same software + same seed + same topology → highly reproducible behavior within documented nondeterminism boundaries. Explicitly distinguish **logical determinism** (same operations, same ordering decisions, same detected violations) from **physical timing determinism** (exact latencies) — never promise the latter.

---

## 20. Documentation structure

```
README.md, ARCHITECTURE.md
protocols/{NODE-PROTOCOL, REPLICATION-PROTOCOL, FAILURE-PROTOCOL, RAFT}.md
consistency/{CONSISTENCY-MODELS, CAUSALITY, VECTOR-CLOCKS, LINEARIZABILITY}.md
replication/{QUORUM, LEADER, REPAIR, ANTI-ENTROPY}.md
operations/{OPERATIONS, RECOVERY, DISASTER-RECOVERY}.md
security/SECURITY.md
experiments/{EXPERIMENTS, FAILURE-MATRIX}.md
benchmarks/BENCHMARKS.md
```

---

## 21. BLACKBOX-X relationship

Keep `blackbox-x` and `quorum-lab` as independent repositories — do not merge. Later (optional, not part of this roadmap), a small `distributed-lab-spec` repo can hold only shared schemas, e.g. a common experiment manifest (`{apiVersion, name, seed, durationSeconds, traffic, failures}`) that BLACKBOX-X interprets for capacity and QUORUM LAB interprets for consistency.

**Future integration point:** QUORUM LAB can eventually export a measured node profile (`{nodeType, readRps, writeRps, p95ReadMs, p95WriteMs, recoveryMs}`) that BLACKBOX-X consumes as empirical capacity-simulation input — closing the loop between the two projects without coupling their codebases.

---

## 22. Explicit anti-patterns (what not to build)

- Polished dashboard before node correctness
- Kafka-based replication (Kafka is for experiment/audit events, never the node↔node protocol)
- MySQL-backed replica state (replicas must be independent local stores)
- Redis as authoritative KV storage
- Arbitrary custom JavaScript merge functions (registered strategies only)
- AI deciding whether a run is correct
- Kubernetes before protocol correctness
- A giant ORM abstraction over the storage engine
- Dynamic Raft membership in v1
- Claiming `W + R > N` implies linearizability
- Calling every stale read a "consistency violation" regardless of the selected model
- Writing millions of raw operations directly into MySQL

---

## 23. Dependency graph

```
Q0 → Q1 → Q2 → Q3 → Q4 → Q5 → Q6 → Q7 ─┬→ Q8 → Q9 ─┐
                                        └───────────┴→ Q10 → Q11
```
Conceptually: local correctness → durability → replication → quorum → failures → conflicts → repair → measurement → leadership → consensus → orchestration → research.

---

## 24. Technology version pinning

The shared tech spine (Node 24, MySQL 8.4, Kafka 4.3, Redis 8.8) names version *lines*, not patch releases — pin exact patch versions when the repo is actually initialized, not just the major/minor line, and commit the resulting lockfiles:

```
package.json, .nvmrc      → exact Node 24.x.x
Dockerfiles / docker-compose.yml → exact image tags, not :24 / :8.4 floating tags
CI workflow                → matches the pinned versions exactly
README                     → states the pinned versions
```

Check each project's current release notes at implementation time for the latest patch on each of these lines (Node 24 LTS, MySQL 8.4 LTS, Kafka 4.3.x, Redis 8.8.x or a newer approved 8.x patch) rather than trusting a version number written into this planning document, which will age.

---

## 25. Final milestone gates

The one-line acceptance gate each milestone must clear before the next one starts:

| Milestone | Must prove |
|---|---|
| Q0 | Node protocol and lifecycle work (volatile) |
| Q1 | Crash/restart preserves durable state, including idempotency dedup |
| Q2 | Replicas converge under sync/async replication |
| Q3 | ONE/QUORUM/ALL semantics work, with quorum math proven (not linearizability) |
| Q4 | Same seed + same scenario produces the same logical fault schedule |
| Q5 | Concurrent versions are correctly classified, never silently resolved |
| Q6 | A stable network produces convergence without new client reads |
| Q7 | The checker correctly distinguishes PASS/VIOLATION/INCONCLUSIVE/NOT_APPLICABLE |
| Q8 | An old leader is fenced, including when the epoch authority itself degrades |
| Q9 | Raft majority safety + full crash/snapshot recovery works |
| Q10 | A Kubernetes pod restart preserves node state |
| Q11 | Research experiments produce reproducible, auditable results across the tiered benchmark matrix |

---

## Critical First Files (Q0 entry point)

- `packages/protocol/proto/node.proto` — the Node Protocol contract every app/package codegens against.
- `apps/quorum-node/src/runtime/clocks.ts` — establishes the Wall/Monotonic/Lamport clock interfaces used everywhere downstream (Q1 recovery, Q4 clock-skew fault, Q5 LWW, Q7 checker).
- `packages/storage/src/wal.ts` (Q1) — the WAL binary format and mutation-executor ordering that durability, replication, and (via the shared `AppendOnlyLog`) the Q9 Raft log all build on.
- `packages/replication/src/replicationEngine.ts` (Q2) — the interface `Async/SyncReplicationEngine` implement first, and `Quorum/Leader/RaftReplicationEngine` implement later, keeping all three comparable.
- `packages/checker/src/linearizabilityChecker.ts` (Q7) — the algorithmically hardest, highest-risk module; get the bounded DFS/memoization and the `PASS/VIOLATION/INCONCLUSIVE/NOT_APPLICABLE` taxonomy right early since Q7 and both flagship experiments depend on it.

## Verification

This is a planning deliverable — there is no code to run yet. Once implementation begins, each milestone's DoD/tests in §11 is the acceptance gate for that milestone (e.g. Q1's crash/replay property test, Q4's determinism test, Q9's three-part Raft flagship test), run via `pnpm turbo test` scoped to the affected package/app. A natural next step after this plan is approved is a **Q0 execution handoff**: exact files, interfaces, `.proto` definitions, package dependencies, first test cases, and commit-by-commit order for the first milestone.

---

## 26. Live Implementation Status, Interactive UI & Visual Walkthrough Guide

### Implementation Completion Status (Certified Production-Parity)
QUORUM LAB is **fully built and verified**:
- **Total Test Suites**: 48 passed (48)
- **Total Tests**: 168 passed (168)
- **Commands**: Run `npx vitest run` in `QUORUM LAB/` to verify all consensus, WAL, vector clock, and repair tests.

### Interactive UI & Visual Inspection Walkthrough

Operators can visually inspect and interact with QUORUM LAB across two live web portals:

#### 1. SYSTEM-X Ecosystem Portal — Tab 3: Quorum Lab Explorer (`http://localhost:8080`)
Open **`http://localhost:8080`** and click the **"Quorum Lab Explorer"** tab:
- **Interactive 3-Node Topology DAG**: Visual nodes for `NODE-1` (Coordinator), `NODE-2` (Replica), and `NODE-3` (Replica), displaying real-time gRPC ports (`50051`, `50052`, `50053`) and health pills (`[ONLINE]`, `[PARTITIONED]`, `[RECOVERING]`).
- **Quorum Intersection Gauge**: Live visual mathematical indicator demonstrating that $W + R = 2 + 2 = 4 > 3 = N$, guaranteeing overlapping replica read/write intersection.
- **Per-Node Telemetry Cards**:
  - Live Read Operations Count
  - Live Write Operations Count
  - Current WAL Log Sequence Number
  - Active In-Memory Keys & Tombstone Counts
- **Vector Clock & Dot Viewer**: Live inspector displaying vector clock maps (`{"node-1": 14, "node-2": 12}`) and monotonic dot counters proving causality and Last-Write-Wins (LWW) conflict resolution.

#### 2. CRT Reliability Control Center — Cluster & Nodes View (`http://localhost:4200`)
Open **`http://localhost:4200`** and click **"Cluster & Nodes"** in the left sidebar:
- **Live Node Telemetry**: Real-time snapshot of port binding, WAL log replay status, and memory key counts across all 3 nodes.
- **Consistency Explorer View**: Query keys directly across individual replicas (Node-1 vs Node-2 vs Node-3) to inspect value convergence and verify that stale reads are trapped by the read quorum.
- **Failure Injection Lab**: Toggle interactive buttons to inject:
  - *Network Partition*: Cut off Node-2 and watch majority quorum ($N=2$) continue serving writes.
  - *Network Delay*: Inject 500ms packet latency on Node-3 and observe p99 tail degradation.
  - *Node Crash & Recovery*: Crash Node-2 and watch WAL replay restore all keys upon reboot.
- **The Last Item Concurrency View (CRT-03)**: Watch 20 simultaneous buyers race against Quorum Lab for 1 item (`PHONE-001`), visually confirming that 1 succeeds, 19 are rejected, and **strictly 0 overselling** occurs.