import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';

const TEST_BASE_DIR = path.resolve('./tests/tmp-sync-cluster');

describe('QuorumNode Integration: 3-Node Synchronous Replication (§Q2)', () => {
  let nodeA: QuorumNodeApp;
  let nodeB: QuorumNodeApp;
  let nodeC: QuorumNodeApp;
  let portA: number;
  let portB: number;
  let portC: number;

  beforeAll(async () => {
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_BASE_DIR, { recursive: true });

    const clusterConfig = {
      membershipVersion: 1,
      members: ['node-a', 'node-b', 'node-c']
    };

    // Initialize 3 nodes
    nodeA = new QuorumNodeApp(
      {
        node: {
          id: 'node-a',
          clusterId: 'cluster-sync',
          dataDir: path.join(TEST_BASE_DIR, 'node-a'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'SYNC', durabilityMode: 'SYNC_FSYNC' }
    );

    nodeB = new QuorumNodeApp(
      {
        node: {
          id: 'node-b',
          clusterId: 'cluster-sync',
          dataDir: path.join(TEST_BASE_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'NONE', durabilityMode: 'SYNC_FSYNC' }
    );

    nodeC = new QuorumNodeApp(
      {
        node: {
          id: 'node-c',
          clusterId: 'cluster-sync',
          dataDir: path.join(TEST_BASE_DIR, 'node-c'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'NONE', durabilityMode: 'SYNC_FSYNC' }
    );

    portA = await nodeA.start();
    portB = await nodeB.start();
    portC = await nodeC.start();

    // Register peers in node-a's peer pool
    nodeA.engine.peerPool.registerPeer({ nodeId: 'node-b', address: `127.0.0.1:${portB}` });
    nodeA.engine.peerPool.registerPeer({ nodeId: 'node-c', address: `127.0.0.1:${portC}` });
  });

  afterAll(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop()]);
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('synchronously replicates PUT from coordinator node-a to peers node-b and node-c', async () => {
    const putResult = await nodeA.engine.put({
      key: 'sync-item',
      value: Buffer.from('replicated-payload'),
      runId: 'run-sync',
      clientId: 'client-1',
      requestId: 'req-sync-1',
      operationId: 'op-sync-1'
    });

    // 1. Verify coordinator response
    expect(putResult.replicationResult).toBeDefined();
    expect(putResult.replicationResult?.totalReplicaAcks).toBe(3);
    expect(putResult.replicationResult?.totalDurableAcks).toBe(3);

    // 2. Immediately verify node-b has the data
    const getB = nodeB.engine.get({ key: 'sync-item' });
    expect(getB.keyState.entries).toHaveLength(1);
    expect(Buffer.from(getB.keyState.entries[0]?.value as Uint8Array).toString()).toBe('replicated-payload');
    expect(getB.keyState.entries[0]?.version.dot.nodeId).toBe('node-a');

    // 3. Immediately verify node-c has the data
    const getC = nodeC.engine.get({ key: 'sync-item' });
    expect(getC.keyState.entries).toHaveLength(1);
    expect(Buffer.from(getC.keyState.entries[0]?.value as Uint8Array).toString()).toBe('replicated-payload');
    expect(getC.keyState.entries[0]?.version.dot.nodeId).toBe('node-a');
  });

  it('synchronously replicates DELETE tombstone to all peers', async () => {
    const delResult = await nodeA.engine.delete({
      key: 'sync-item',
      runId: 'run-sync',
      clientId: 'client-1',
      requestId: 'req-sync-2',
      operationId: 'op-sync-2'
    });

    expect(delResult.replicationResult?.totalReplicaAcks).toBe(3);

    const getB = nodeB.engine.get({ key: 'sync-item' });
    expect(getB.keyState.entries).toHaveLength(1);
    expect(getB.keyState.entries[0]?.tombstone).toBe(true);

    const getC = nodeC.engine.get({ key: 'sync-item' });
    expect(getC.keyState.entries).toHaveLength(1);
    expect(getC.keyState.entries[0]?.tombstone).toBe(true);
  });
});
