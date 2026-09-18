# Operational Runbook: Backup and Disaster Recovery

## 1. Quorum Node PVC Backup Architecture

Each `quorum-node` stores:
- **Write-Ahead Log (WAL)**: `wal.log` with length-prefixed CRC32C framed mutation envelopes.
- **Snapshot Files**: `snapshot-<seq>.snap` with full atomic point-in-time state machine dumps.
- **Tombstones & Hints**: Durable records persisted in local storage engine.

### Automated Snapshot Triggers
1. Scheduled snapshots occur via Kubernetes `CronJob` `quorum-snapshot-backup`.
2. Manual trigger via gRPC `CreateSnapshot` RPC:
   ```bash
   grpcurl -plaintext -d '{"run_id": "backup-manual-1"}' \
     quorum-node-0.quorum-node-headless.quorum-lab.svc.cluster.local:50051 \
     quorum.node.v1.NodeService/CreateSnapshot
   ```

### CSI Volume Snapshot
For production clusters running with AWS EBS, GCP Persistent Disk, or Azure Disk CSI drivers:
```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: quorum-node-0-backup-snapshot
  namespace: quorum-lab
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: quorum-data-quorum-node-0
```

---

## 2. Disaster Recovery Procedure

### Scenario A: Single Node PVC Corruption / Failure
If a single node volume is corrupted or lost:
1. Delete the failed pod and PVC:
   ```bash
   kubectl delete pod quorum-node-1 -n quorum-lab
   kubectl delete pvc quorum-data-quorum-node-1 -n quorum-lab
   ```
2. The StatefulSet controller automatically recreates `quorum-data-quorum-node-1` and provisions a new pod `quorum-node-1`.
3. `quorum-node-1` boots up empty (`replayed=0`).
4. Anti-entropy Merkle repair (§Q6) and Raft `InstallSnapshot` / `AppendEntries` (§Q9) automatically stream historical entries and state snapshots from healthy peers `quorum-node-0` and `quorum-node-2`, restoring the replacement replica to full consistency!

### Scenario B: Full Cluster Recovery from Off-Site Backup
1. Restore database metadata (`control-api` MySQL backup).
2. Provision target PVCs from VolumeSnapshots:
   ```bash
   kubectl apply -f restore-pvc.yaml
   ```
3. Deploy `quorum-node` StatefulSet.
4. Each node boots up, executes `StorageEngine.recover()`, restores latest snapshot, and replays uncompacted WAL segments up to the highest recorded sequence number.
5. Leader election commences and normal cluster operation resumes.

---

## 3. Kafka & MySQL Retention Policies

- **Kafka Event Streaming**:
  - `quorum.replication.events`: retention period 7 days (`retention.ms=604800000`).
  - `quorum.fault.injections`: retention period 30 days (`retention.ms=2592000000`).
  - Compacted topics for state changes: `cleanup.policy=compact`.
- **MySQL Control Plane**:
  - Daily mysqldump or RDS automated daily snapshots retained for 30 days.
