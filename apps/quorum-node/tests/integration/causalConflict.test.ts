import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import { CausalConsistencyError } from '@quorum-lab/replication';

const TEST_BASE_DIR = path.resolve('./tests/tmp-causal-cluster');

describe('QuorumNode: Conflict Resolution & Causal Consistency (§Q5)', () => {
  let nodeA: QuorumNodeApp;
  let nodeB: QuorumNodeApp;
  let portA: number;
  let portB: number;

  beforeAll(async () => {
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_BASE_DIR, { recursive: true });

    const clusterConfig = {
      membershipVersion: 1,
      members: ['node-a', 'node-b']
    };

    nodeA = new QuorumNodeApp(
      {
        node: {
          id: 'node-a',
          clusterId: 'cluster-causal',
          dataDir: path.join(TEST_BASE_DIR, 'node-a'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'QUORUM', quorumConfig: { W: 1, R: 1 } }
    );

    nodeB = new QuorumNodeApp(
      {
        node: {
          id: 'node-b',
          clusterId: 'cluster-causal',
          dataDir: path.join(TEST_BASE_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'QUORUM', quorumConfig: { W: 1, R: 1 } }
    );

    portA = await nodeA.start();
    portB = await nodeB.start();

    nodeA.engine.peerPool.registerPeer({ nodeId: 'node-b', address: `127.0.0.1:${portB}` });
    nodeB.engine.peerPool.registerPeer({ nodeId: 'node-a', address: `127.0.0.1:${portA}` });
  });

  afterAll(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop()]);
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('retains concurrent sibling entries under MULTI_VALUE conflict strategy', async () => {
    // Write independently on node-a
    const putA = await nodeA.engine.put({
      key: 'sibling-key',
      value: Buffer.from('val-from-a'),
      runId: 'run-c1',
      clientId: 'client-1',
      requestId: 'req-a1',
      operationId: 'op-a1'
    });

    // Write independently on node-b (concurrent dot)
    const putB = await nodeB.engine.put({
      key: 'sibling-key',
      value: Buffer.from('val-from-b'),
      runId: 'run-c1',
      clientId: 'client-2',
      requestId: 'req-b1',
      operationId: 'op-b1'
    });

    // Replicate entry from node-a into node-b
    await nodeB.engine.applyReplicatedEntry({
      key: 'sibling-key',
      entry: {
        value: Buffer.from('val-from-a'),
        tombstone: false,
        version: putA.version
      },
      sourceNode: 'node-a',
      fencingEpoch: 0,
      membershipHash: nodeB.runtime.getMembership().hash,
      operationId: 'op-rep-a1',
      requestId: 'req-rep-a1'
    });

    // Node-b's raw store must hold BOTH undominated concurrent entries
    const rawStateB = nodeB.engine.get({ key: 'sibling-key' });
    expect(rawStateB.keyState.entries).toHaveLength(2);

    // Read with MULTI_VALUE returns all concurrent siblings
    const multiValRead = await nodeB.engine.distributedGet({
      key: 'sibling-key',
      conflictStrategy: 'MULTI_VALUE'
    });
    expect(multiValRead.keyState.entries).toHaveLength(2);

    // Read with LAST_WRITE_WINS projects a single winner without deleting the sibling
    const lwwRead = await nodeB.engine.distributedGet({
      key: 'sibling-key',
      conflictStrategy: 'LAST_WRITE_WINS'
    });
    expect(lwwRead.keyState.entries).toHaveLength(1);

    // Invariant: underlying storage still retains both undominated versions
    expect(nodeB.engine.get({ key: 'sibling-key' }).keyState.entries).toHaveLength(2);
  });

  it('satisfies causal read consistency by querying peers when local replica is stale', async () => {
    // Write a new key exclusively to node-a
    const putA = await nodeA.engine.put({
      key: 'causal-key-1',
      value: Buffer.from('causal-update-from-a'),
      runId: 'run-c2',
      clientId: 'client-1',
      requestId: 'req-causal-1',
      operationId: 'op-causal-1'
    });

    const clientCausalDependency = { 'node-a': putA.version.dot.counter };

    // Initially, node-b does not have this key locally
    const localB = nodeB.engine.get({ key: 'causal-key-1' });
    expect(localB.keyState.entries).toHaveLength(0);

    // Client reads from node-b with causal dependency
    // Node-b sees its local state does not satisfy the causal dependency, queries node-a, and returns the update!
    const causalRead = await nodeB.engine.distributedGet({
      key: 'causal-key-1',
      causalDependency: clientCausalDependency
    });

    expect(causalRead.keyState.entries).toHaveLength(1);
    expect(Buffer.from(causalRead.keyState.entries[0]?.value as Uint8Array).toString()).toBe('causal-update-from-a');
  });

  it('throws CausalConsistencyError when causal dependency cannot be satisfied', async () => {
    // Client requires a non-existent future dot from node-a that no replica has
    const impossibleDependency = { 'node-a': 999999 };

    await expect(
      nodeB.engine.distributedGet({
        key: 'causal-key-1',
        causalDependency: impossibleDependency
      })
    ).rejects.toThrow(CausalConsistencyError);
  });
});
