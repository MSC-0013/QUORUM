# Operational Runbook: Quorum Node Upgrade and Rollback

## Overview

`quorum-node` runs as a Kubernetes `StatefulSet` with persistent volume claims (PVCs) retaining write-ahead logs (WAL) and state machine snapshots across pod lifecycles.

Because `quorum-node` manages consensus, replication, and distributed state across $N=3$ replicas, upgrades must be executed sequentially with zero quorum disruption.

---

## 1. Zero-Downtime Rolling Upgrade Procedure

### Pre-Upgrade Verification
1. Verify cluster health:
   ```bash
   kubectl get statefulset -n quorum-lab quorum-node
   kubectl get pods -n quorum-lab -l app=quorum-node -o wide
   ```
2. Verify all $N=3$ pods report `Ready (1/1)` and replication lag is within limits (< 50ms).
3. Confirm PodDisruptionBudget is active (`maxUnavailable: 1`):
   ```bash
   kubectl get pdb -n quorum-lab quorum-node-pdb
   ```

### Partitioned Rolling Update
To maintain complete control and verify state before advancing, utilize `RollingUpdate` partition:

1. Set the partition to $N-1=2$:
   ```bash
   kubectl patch statefulset quorum-node -n quorum-lab -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":2}}}}'
   ```
2. Update the container image:
   ```bash
   kubectl set image statefulset/quorum-node -n quorum-lab quorum-node=quorum-lab/quorum-node:v1.2.0
   ```
3. Pod `quorum-node-2` will terminate and recreate with the new image.
4. Monitor the pod's startup and recovery:
   ```bash
   kubectl logs -f -n quorum-lab quorum-node-2
   ```
   *Verify recovery log output:*
   `[NODE quorum-node-2] Recovery complete: snapshot=true, replayed=X, lastSeq=Y`
5. Await readiness probe pass:
   ```bash
   kubectl wait --for=condition=Ready pod/quorum-node-2 -n quorum-lab --timeout=120s
   ```
6. Decrement partition to 1 to upgrade `quorum-node-1`:
   ```bash
   kubectl patch statefulset quorum-node -n quorum-lab -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":1}}}}'
   kubectl wait --for=condition=Ready pod/quorum-node-1 -n quorum-lab --timeout=120s
   ```
7. Finally, decrement partition to 0 to upgrade `quorum-node-0`:
   ```bash
   kubectl patch statefulset quorum-node -n quorum-lab -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":0}}}}'
   kubectl wait --for=condition=Ready pod/quorum-node-0 -n quorum-lab --timeout=120s
   ```

---

## 2. Emergency Rollback Procedure

If a newly deployed version encounters panics, unhandled errors, or failing readiness probes:

1. Immediately halt further updates by freezing partition:
   ```bash
   kubectl patch statefulset quorum-node -n quorum-lab -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":3}}}}'
   ```
2. Revert image to previously trusted release:
   ```bash
   kubectl set image statefulset/quorum-node -n quorum-lab quorum-node=quorum-lab/quorum-node:v1.1.0
   ```
3. Roll back individual nodes one by one by stepping partition down:
   ```bash
   kubectl patch statefulset quorum-node -n quorum-lab -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":2}}}}'
   kubectl wait --for=condition=Ready pod/quorum-node-2 -n quorum-lab --timeout=120s
   kubectl patch statefulset quorum-node -n quorum-lab -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":0}}}}'
   ```
4. Verify all nodes restore replication consensus and serve read/write requests.
