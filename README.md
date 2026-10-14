# QUORUM LAB

> **Distributed Key-Value Laboratory for Injecting Failures, Decoupled Consistency & Fault Verification**  
> High-performance distributed storage and consensus engine implementing 5-axis decoupled consistency policies, Write-Ahead Logging (WAL), vector clocks, Merkle-tree anti-entropy repair, and Raft consensus over gRPC.

> [!IMPORTANT]
> ### 🌐 DIRECT LIVE WEB DASHBOARDS (CLICK TO OPEN IN BROWSER)
> - 🖥️ **SYSTEM-X Ecosystem Portal (Quorum Explorer Tab)**: 👉 **[http://localhost:8080](http://localhost:8080)**  
> - 🛒 **Commerce Reliability Testbed (Cluster & Nodes View)**: 👉 **[http://localhost:4200](http://localhost:4200)**  

---

## 1. Executive Summary

QUORUM LAB answers the definitive systems engineering question: **"What actually happens?"**

Distributed systems rarely fail cleanly—they degrade under partial network partitions, disk write pauses, clock skews, and concurrent conflicting writes. QUORUM LAB serves as a production-parity distributed testbed capable of running real multi-node topologies, enforcing strict quorum intersection ($W + R > N$), and verifying consistency guarantees under active fault injection.

When integrated into **SYSTEM-X** and the **Commerce Reliability Testbed (CRT)**, QUORUM LAB provides the empirical ground truth for real-world application resilience.

---

## 2. Cluster Topology & Invariants

```text
                        +----------------------+
                        |    CLIENT / ADAPTER  |
                        +----------+-----------+
                                   |
         +-------------------------+-------------------------+
         | (gRPC / In-Process)     |                         |
         v                         v                         v
+-----------------+       +-----------------+       +-----------------+
|     NODE-1      | <---> |     NODE-2      | <---> |     NODE-3      |
|  (Coordinator)  |       |   (Replica)     |       |   (Replica)     |
| • WAL Storage   |       | • WAL Storage   |       | • WAL Storage   |
| • MemStore      |       | • MemStore      |       | • MemStore      |
| • Vector Clocks |       | • Vector Clocks |       | • Vector Clocks |
| • Merkle Tree   |       | • Merkle Tree   |       | • Merkle Tree   |
+-----------------+       +-----------------+       +-----------------+
```

### Core Invariants
- **Quorum Intersection**: With cluster size $N=3$, write quorum $W=2$, and read quorum $R=2$, the pigeonhole principle guarantees $W + R = 4 > 3$, ensuring at least one overlapping replica contains the most recent write.
- **Append-Only WAL Durability**: All mutations are synchronously flushed (`SYNC_FSYNC`) to disk with CRC32C checksums before client acknowledgment.
- **Strict Idempotency Table**: Coordinator enforces deduplication on `(clientId, requestId)` to guarantee exactly-once mutation semantics.
- **Vector Clock Domination**: Version stamps track causality using vector clocks and Lamport counters to deterministically resolve concurrent conflicting mutations.

---

## 3. The 5-Axis Decoupled Consistency Model

QUORUM LAB uniquely decouples consistency across five orthogonal architectural axes:

| Axis | Available Options | Description |
|---|---|---|
| **1. Replication Topology** | `LEADERLESS`, `LEADER`, `RAFT` | Coordinator routing, Raft consensus elections, or Dynamo-style leaderless replication. |
| **2. Read Consistency** | `ONE`, `QUORUM` ($R=2$), `ALL`, `EVENTUAL`, `SESSION`, `CAUSAL` | Guarantees including Monotonic Reads, Read-Your-Writes (RYW), and Causal dependency frontiers. |
| **3. Write Ack Policy** | `ONE`, `QUORUM` ($W=2$), `ALL` | Required acknowledgments before returning success to the client. |
| **4. Local Durability** | `MEMORY_ONLY`, `BATCHED_FSYNC`, `SYNC_FSYNC` | Persistence guarantees against sudden process crash or power loss. |
| **5. Conflict Resolution** | `LAST_WRITE_WINS`, `VERSION_VECTOR`, `MULTI_VALUE`, `CUSTOM_MERGE` | Resolution strategy when concurrent sibling writes are detected. |

---

## 4. Repository Architecture: Apps & Packages

```text
QUORUM LAB/
├── apps/
│   ├── quorum-node/            # Core storage node: MemStore, WAL, gRPC server, & replication engine
│   ├── control-api/            # Fastify REST API for cluster discovery, node health, & policies
│   ├── analysis-worker/        # Telemetry analyzer evaluating consistency invariants
│   ├── report-worker/          # Run manifest & interactive report generator
│   └── experiment-worker/      # Fault timeline orchestrator (partitions, delays, crashes)
├── packages/
│   ├── consistency/            # Vector clocks, KeyState, causal domination, & conflict resolvers
│   ├── storage/                # Append-only WAL, CRC32C, recovery manager, & snapshot engine
│   ├── replication/            # Quorum math, sync/async replicators, Raft engine, & leader leases
│   ├── repair/                 # Merkle trees, anti-entropy coordinator, hinted handoff, & tombstone GC
│   ├── protocol/               # Protocol Buffers (.proto) & generated gRPC service stubs
│   ├── contracts/              # Schema validators, node membership, & telemetry records
│   ├── fault-model/            # Deterministic PRNG, fault definitions, & timeline compilation
│   ├── clocks/                 # Hybrid Logical Clocks (HLC) & Lamport timestamps
│   └── benchmarks/             # Latency, throughput, and saturation benchmark suites
├── tests/
│   └── integration/            # Comprehensive cluster integration test suites
└── docs/                       # Operations, backup/restore, mTLS security, & integration guides
```

---

## 5. Storage Engine & Crash Recovery

1. **Write-Ahead Log (WAL)**: Every mutation is serialized into an envelope containing sequence number, client ID, request ID, operation type, payload bytes, and CRC32C checksum.
2. **Crash Recovery Protocol**: Upon node restart:
   - Recovers from latest binary snapshot (if present).
   - Replays uncompacted WAL entries from sequence number forward.
   - Truncates torn writes at the log tail to restore invariant consistency.
3. **Anti-Entropy & Merkle Trees**: Replicas maintain cryptographic Merkle trees over key ranges. Background repair jobs exchange tree roots and descend branches to identify and synchronize out-of-date keys without full table scans.
4. **Tombstone Lifecycle**: Deletions write versioned tombstone entries. Tombstone GC sweeps only purge records after anti-entropy frontiers prove all replicas have observed the deletion.

---

## 6. Live Testing & Verification

QUORUM LAB includes a comprehensive automated test suite validating consensus, replication, storage recovery, and chaos injection:

```bash
# Run all 48 test suites and 168 tests across the monorepo
npx vitest run
```

### Verified Test Categories
- `quorumReplication.test.ts`: Verifies $W=2, R=2$ quorum intersection on 3-node clusters.
- `durableRecovery.test.ts`: Verifies complete data recovery across node process restarts via WAL.
- `leaderFencing.test.ts`: Verifies stale leaders are fenced off when terms advance.
- `raftCluster.test.ts`: Verifies dynamic leader election, log replication, and failover under Raft.
- `antiEntropyRepair.test.ts`: Verifies Merkle tree synchronization across partitioned nodes.
- `mtlsSecurity.test.ts`: Verifies mutual TLS inter-node encryption and certificate enforcement.

---

## 7. Integration with SYSTEM-X & CRT

1. **Adapter-Based RPC Access**: External platforms communicate with QUORUM LAB through a versioned client adapter (`QuorumAdapter`), ensuring no direct internal imports or state leaks.
2. **Empirical Ground Truth**: QUORUM LAB records every operation's latency, version counter, vector clock, and serving node into an immutable ledger for SYSTEM-X statistical certification.
3. **Commerce Testbed Storage**: Powers the inventory check-and-reserve protocol in the **Commerce Reliability Testbed (CRT)**, guaranteeing zero overselling across concurrent buyers.
