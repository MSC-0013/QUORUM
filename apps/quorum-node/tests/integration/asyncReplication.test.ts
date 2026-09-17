import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';

const TEST_ASYNC_DIR = path.resolve('./tests/tmp-async-cluster');

describe('QuorumNode Integration: Asynchronous Eventual Replication (§Q2)', () => {
  let nodeA: QuorumNodeApp;
  let nodeB: QuorumNodeApp;
  let portA: number;
  let portB: number;

  beforeAll(async () => {
    if (fs.existsSync(TEST_ASYNC_DIR)) {
      await fs.promises.rm(TEST_ASYNC_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_ASYNC_DIR, { recursive: true });

    const clusterConfig = {
      membershipVersion: 1,
      members: ['node-a', 'node-b']
    };

    nodeA = new QuorumNodeApp(
      {
        node: {
          id: 'node-a',
          clusterId: 'cluster-async',
          dataDir: path.join(TEST_ASYNC_DIR, 'node-a'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'ASYNC', durabilityMode: 'SYNC_FSYNC' }
    );

    nodeB = new QuorumNodeApp(
      {
        node: {
          id: 'node-b',
          clusterId: 'cluster-async',
          dataDir: path.join(TEST_ASYNC_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'NONE', durabilityMode: 'SYNC_FSYNC' }
    );

    portA = await nodeA.start();
    portB = await nodeB.start();

    nodeA.engine.peerPool.registerPeer({ nodeId: 'node-b', address: `127.0.0.1:${portB}` });
  });

  afterAll(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop()]);
    if (fs.existsSync(TEST_ASYNC_DIR)) {
      await fs.promises.rm(TEST_ASYNC_DIR, { recursive: true, force: true });
    }
  });

  it('asynchronously replicates mutation to peer node-b in the background', async () => {
    const putResult = await nodeA.engine.put({
      key: 'async-item',
      value: Buffer.from('async-payload'),
      runId: 'run-async',
      clientId: 'client-1',
      requestId: 'req-async-1',
      operationId: 'op-async-1'
    });

    // Coordinator returns immediately after local ACK
    expect(putResult.replicationResult?.totalReplicaAcks).toBe(1);

    // Poll until peer receives and converges (eventual consistency)
    let converged = false;
    for (let i = 0; i < 50; i++) {
      const getB = nodeB.engine.get({ key: 'async-item' });
      if (getB.keyState.entries.length > 0) {
        converged = true;
        expect(Buffer.from(getB.keyState.entries[0]?.value as Uint8Array).toString()).toBe('async-payload');
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(converged).toBe(true);
  });
});
