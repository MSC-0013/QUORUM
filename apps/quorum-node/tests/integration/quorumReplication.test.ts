import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import { QuorumWriteError } from '@quorum-lab/replication';

const TEST_BASE_DIR = path.resolve('./tests/tmp-quorum-cluster');

describe('QuorumNode Integration: Quorum Replication (W=2, R=2 on N=3) (§Q3)', () => {
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

    // Initialize 3 nodes with W=2, R=2
    nodeA = new QuorumNodeApp(
      {
        node: {
          id: 'node-a',
          clusterId: 'cluster-quorum',
          dataDir: path.join(TEST_BASE_DIR, 'node-a'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'QUORUM',
        quorumConfig: { W: 2, R: 2 },
        durabilityMode: 'SYNC_FSYNC'
      }
    );

    nodeB = new QuorumNodeApp(
      {
        node: {
          id: 'node-b',
          clusterId: 'cluster-quorum',
          dataDir: path.join(TEST_BASE_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'NONE',
        durabilityMode: 'SYNC_FSYNC'
      }
    );

    nodeC = new QuorumNodeApp(
      {
        node: {
          id: 'node-c',
          clusterId: 'cluster-quorum',
          dataDir: path.join(TEST_BASE_DIR, 'node-c'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'NONE',
        durabilityMode: 'SYNC_FSYNC'
      }
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

  it('satisfies write quorum W=2 and reads back via read quorum R=2', async () => {
    const putRes = await nodeA.engine.put({
      key: 'quorum-key-1',
      value: Buffer.from('quorum-val-1'),
      runId: 'run-q1',
      clientId: 'client-1',
      requestId: 'req-q1',
      operationId: 'op-q1'
    });

    expect(putRes.replicationResult).toBeDefined();
    expect(putRes.replicationResult?.totalReplicaAcks).toBeGreaterThanOrEqual(2);

    // Verify peers received write
    const localB = nodeB.engine.get({ key: 'quorum-key-1' });
    expect(localB.keyState.entries.length).toBe(1);
    expect(Buffer.from(localB.keyState.entries[0]?.value as Uint8Array).toString()).toBe('quorum-val-1');

    // Perform quorum read from coordinator
    const getRes = await nodeA.engine.distributedGet({ key: 'quorum-key-1' });
    expect(getRes.keyState.entries.length).toBe(1);
    expect(Buffer.from(getRes.keyState.entries[0]?.value as Uint8Array).toString()).toBe('quorum-val-1');
  });

  it('fails write with QuorumWriteError when write quorum W=2 cannot be met', async () => {
    // Stop node B and node C to break write quorum
    await nodeB.stop();
    await nodeC.stop();

    await expect(
      nodeA.engine.put({
        key: 'failing-key',
        value: Buffer.from('will-fail'),
        runId: 'run-q2',
        clientId: 'client-1',
        requestId: 'req-q2',
        operationId: 'op-q2'
      })
    ).rejects.toThrow(QuorumWriteError);
  });
});
