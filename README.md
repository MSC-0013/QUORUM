# QUORUM LAB

> Distributed key-value laboratory for injecting failures, changing consistency policies, and measuring replica divergence under real fault scenarios.

## Architectural Spine
- **Runtime:** Node.js 24 LTS + TypeScript 5.8 (Strict Mode)
- **Monorepo:** Turborepo + pnpm
- **Protocols:** gRPC + Protocol Buffers
- **Testing:** Vitest

## Roadmap
- **Q0** Foundation + Node Protocol (Volatile, in-memory engine, protocol contracts, lifecycle)
- **Q1** Durable Storage (WAL, snapshotting, crash recovery)
- **Q2** Replication Engine (Leaderless async/sync replication)
- **Q3** Quorum + Control Plane (R/W quorum policies, Fastify API)
- **Q4** Failure Injection + Experiment Runtime
- **Q5** Conflict + Causality
- **Q6** Repair + Convergence
- **Q7** Correctness + Verification
- **Q8** Leader + Fencing
- **Q9** Raft
- **Q10** Kubernetes + Productionization
- **Q11** Research + Benchmarking
