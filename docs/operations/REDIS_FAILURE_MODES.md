# Operational Reference: Redis Failure Modes & Lease Fencing

## Context

In single-leader configurations (§Q8), Redis is optionally used as a fast distributed lock and lease provider to establish leader leases.

When Redis encounters network partitions, crashes, or failovers, lease safety invariants must guarantee zero split-brain writes.

---

## 1. Failure Scenarios and Guarantees

| Failure Scenario | Redis State | Node Behavior | Safety Guarantee |
| :--- | :--- | :--- | :--- |
| **Transient Network Blip (< leaseDurationMs)** | Active | Leader renews before lease expires | Uninterrupted write serving |
| **Prolonged Redis Outage (> leaseDurationMs)** | Unreachable | Leader lease expires; leader transitions to stepped-down or `UNSAFE` mode | Leader rejects writes with `UnsafeLeaderError` |
| **Redis Crash + Restart with Lost Data** | Flushed memory | Nodes do not assume existing leases remain valid; epoch verification prevents stale writes | Fencing coordinator detects generation mismatch |
| **Split-Brain Candidate Ascension** | Secondary elected | Old leader write blocked by follower fencing token check (`STATUS_CODE_FENCED`) | Strict split-brain write prevention |

---

## 2. The UNSAFE Mode Safety Invariant (§Q8, §18)

When a node detects that its external lease authority (Redis or consensus coordinator) has degraded:
1. It immediately disables local write acceptance.
2. Reads falling under `STRICT_LINEARIZABLE` consistency are rejected.
3. If configured for `UNSAFE` fallback:
   - Writes may only proceed if explicitly marked with an emergency bypass header (`x-emergency-unsafe-ack`).
   - All mutations generated under this condition are flagged with an `UNSAFE` marker in the WAL envelope to ensure auditability during post-incident analysis.
