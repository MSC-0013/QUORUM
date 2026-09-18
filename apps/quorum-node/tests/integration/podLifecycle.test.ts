import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import { buildStatefulSetAppConfig, parsePodOrdinal } from '../../src/cluster/ordinalDiscovery.js';

const TEST_PVC_DIR = path.resolve('./tests/tmp-pvc-quorum-node-0');

describe('QuorumNode: Kubernetes StatefulSet Pod Lifecycle & PVC Preservation (§Q10)', () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_PVC_DIR)) {
      await fs.promises.rm(TEST_PVC_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_PVC_DIR, { recursive: true });
  });

  afterAll(async () => {
    if (fs.existsSync(TEST_PVC_DIR)) {
      await fs.promises.rm(TEST_PVC_DIR, { recursive: true, force: true });
    }
  });

  it('correctly parses pod ordinal and headless peer endpoints from StatefulSet hostname', () => {
    const podInfo = parsePodOrdinal('quorum-node-2');
    expect(podInfo.ordinal).toBe(2);
    expect(podInfo.nodeId).toBe('quorum-node-2');

    const { config, peerEndpoints } = buildStatefulSetAppConfig({
      podName: 'quorum-node-1',
      headlessService: 'quorum-node-headless.quorum-lab.svc.cluster.local',
      clusterSize: 3,
      dataDir: '/data',
      grpcPort: 50051
    });

    expect(config.node.id).toBe('quorum-node-1');
    expect(config.cluster.members).toEqual(['quorum-node-0', 'quorum-node-1', 'quorum-node-2']);
    expect(peerEndpoints).toHaveLength(2);
    expect(peerEndpoints.map((p) => p.nodeId)).toEqual(['quorum-node-0', 'quorum-node-2']);
    expect(peerEndpoints[0]!.address).toBe('quorum-node-0.quorum-node-headless.quorum-lab.svc.cluster.local:50051');
  });

  it('preserves node state, WAL, snapshots, and version continuity across pod restart with persistent PVC', async () => {
    // -------------------------------------------------------------
    // PHASE 1: Pod instance 1 runs on the persistent PVC volume
    // -------------------------------------------------------------
    const { config: config1 } = buildStatefulSetAppConfig({
      podName: 'quorum-node-0',
      headlessService: 'quorum-node-headless.quorum-lab.svc.cluster.local',
      clusterSize: 3,
      dataDir: TEST_PVC_DIR,
      grpcPort: 0,
      grpcHost: '127.0.0.1'
    });

    const pod1 = new QuorumNodeApp(config1);
    const port1 = await pod1.start();
    expect(port1).toBeGreaterThan(0);
    expect(pod1.lifecycle.getState()).toBe('HEALTHY');

    // Execute multiple writes
    const putRes1 = await pod1.engine.put({
      key: 'k8s:pvc:alpha',
      value: Buffer.from('data-before-pod-restart-1'),
      runId: 'run-k8s-1',
      clientId: 'client-k8s-1',
      requestId: 'req-k8s-1',
      operationId: 'op-k8s-1'
    });

    const putRes2 = await pod1.engine.put({
      key: 'k8s:pvc:beta',
      value: Buffer.from('data-before-pod-restart-2'),
      runId: 'run-k8s-1',
      clientId: 'client-k8s-1',
      requestId: 'req-k8s-2',
      operationId: 'op-k8s-2'
    });

    expect(putRes1.version.dot.counter).toBe(1);
    expect(putRes2.version.dot.counter).toBe(2);

    // Create an atomic disk snapshot on the PVC
    const snapReport = await pod1.engine.createSnapshot();
    expect(snapReport.snapshotSequence).toBeGreaterThan(0n);

    // Write another key after snapshot (to verify WAL replay past snapshot)
    const putRes3 = await pod1.engine.put({
      key: 'k8s:pvc:gamma',
      value: Buffer.from('data-after-snapshot'),
      runId: 'run-k8s-1',
      clientId: 'client-k8s-1',
      requestId: 'req-k8s-3',
      operationId: 'op-k8s-3'
    });
    expect(putRes3.version.dot.counter).toBe(3);

    // Delete pod 1 (simulating `kubectl delete pod quorum-node-0` or worker node eviction)
    await pod1.stop();
    expect(pod1.lifecycle.getState()).toBe('TERMINATED');

    // -------------------------------------------------------------
    // PHASE 2: Replacement pod rescheduled and attached to identical PVC
    // -------------------------------------------------------------
    const { config: config2 } = buildStatefulSetAppConfig({
      podName: 'quorum-node-0',
      headlessService: 'quorum-node-headless.quorum-lab.svc.cluster.local',
      clusterSize: 3,
      dataDir: TEST_PVC_DIR,
      grpcPort: 0,
      grpcHost: '127.0.0.1'
    });

    const pod2 = new QuorumNodeApp(config2);
    const port2 = await pod2.start();
    expect(port2).toBeGreaterThan(0);
    expect(pod2.lifecycle.getState()).toBe('HEALTHY');

    // Verify all keys preserved and readable from recovered state
    const readAlpha = pod2.engine.get({ key: 'k8s:pvc:alpha' });
    expect(readAlpha.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readAlpha.keyState.entries[0]!.value as Uint8Array).toString()).toBe('data-before-pod-restart-1');

    const readBeta = pod2.engine.get({ key: 'k8s:pvc:beta' });
    expect(readBeta.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readBeta.keyState.entries[0]!.value as Uint8Array).toString()).toBe('data-before-pod-restart-2');

    const readGamma = pod2.engine.get({ key: 'k8s:pvc:gamma' });
    expect(readGamma.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readGamma.keyState.entries[0]!.value as Uint8Array).toString()).toBe('data-after-snapshot');

    // Verify subsequent write continues monotonic sequence without gap or collision
    const putRes4 = await pod2.engine.put({
      key: 'k8s:pvc:delta',
      value: Buffer.from('data-after-reschedule'),
      runId: 'run-k8s-2',
      clientId: 'client-k8s-1',
      requestId: 'req-k8s-4',
      operationId: 'op-k8s-4'
    });
    expect(putRes4.version.dot.counter).toBe(4);

    // Verify idempotency table persisted across restart: retrying req-k8s-3 yields duplicate
    const dedupRes = await pod2.engine.put({
      key: 'k8s:pvc:gamma',
      value: Buffer.from('data-after-snapshot'),
      runId: 'run-k8s-1',
      clientId: 'client-k8s-1',
      requestId: 'req-k8s-3',
      operationId: 'op-k8s-3'
    });
    expect(dedupRes.isDuplicate).toBe(true);

    await pod2.stop();
  });
});
