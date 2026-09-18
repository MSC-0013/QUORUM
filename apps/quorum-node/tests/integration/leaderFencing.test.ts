import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import { NotLeaderError, UnsafeLeaderError } from '@quorum-lab/replication';
import { ProtoStatusCode } from '@quorum-lab/protocol';

const TEST_BASE_DIR = path.resolve('./tests/tmp-leader-cluster');

describe('QuorumNode: Leader & Fencing Integration (§Q8)', () => {
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

    // Node A is designated leader initially with epoch 1
    nodeA = new QuorumNodeApp(
      {
        node: {
          id: 'node-a',
          clusterId: 'cluster-leader',
          dataDir: path.join(TEST_BASE_DIR, 'node-a'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'LEADER',
        quorumConfig: { W: 2, R: 1 },
        leaderConfig: { initialLeaderId: 'node-a', initialEpoch: 1, leaseDurationMs: 10000 }
      }
    );

    // Node B is initially follower
    nodeB = new QuorumNodeApp(
      {
        node: {
          id: 'node-b',
          clusterId: 'cluster-leader',
          dataDir: path.join(TEST_BASE_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'LEADER',
        quorumConfig: { W: 2, R: 1 },
        leaderConfig: { initialLeaderId: 'node-a', initialEpoch: 1, leaseDurationMs: 10000 }
      }
    );

    // Node C is initially follower
    nodeC = new QuorumNodeApp(
      {
        node: {
          id: 'node-c',
          clusterId: 'cluster-leader',
          dataDir: path.join(TEST_BASE_DIR, 'node-c'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'LEADER',
        quorumConfig: { W: 2, R: 1 },
        leaderConfig: { initialLeaderId: 'node-a', initialEpoch: 1, leaseDurationMs: 10000 }
      }
    );

    portA = await nodeA.start();
    portB = await nodeB.start();
    portC = await nodeC.start();

    // Cross-register peers in PeerClientPools
    nodeA.engine.peerPool.registerPeer({ nodeId: 'node-b', address: `127.0.0.1:${portB}` });
    nodeA.engine.peerPool.registerPeer({ nodeId: 'node-c', address: `127.0.0.1:${portC}` });

    nodeB.engine.peerPool.registerPeer({ nodeId: 'node-a', address: `127.0.0.1:${portA}` });
    nodeB.engine.peerPool.registerPeer({ nodeId: 'node-c', address: `127.0.0.1:${portC}` });

    nodeC.engine.peerPool.registerPeer({ nodeId: 'node-a', address: `127.0.0.1:${portA}` });
    nodeC.engine.peerPool.registerPeer({ nodeId: 'node-b', address: `127.0.0.1:${portB}` });
  });

  afterAll(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop()]);
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('accepts writes on designated leader and replicates with epoch to followers', async () => {
    const putRes = await nodeA.engine.put({
      key: 'leader:key:1',
      value: Buffer.from('leader-data-1'),
      runId: 'run-l1',
      clientId: 'client-1',
      requestId: 'req-l1',
      operationId: 'op-l1'
    });

    expect(putRes.replicationResult?.totalReplicaAcks).toBeGreaterThanOrEqual(2);

    // Follower node B must have received the replicated mutation
    const stateB = nodeB.engine.get({ key: 'leader:key:1' });
    expect(stateB.keyState.entries).toHaveLength(1);
    expect(Buffer.from(stateB.keyState.entries[0]!.value as Uint8Array).toString()).toBe('leader-data-1');
  });

  it('rejects client writes on non-leader replica with NotLeaderError', async () => {
    await expect(
      nodeB.engine.put({
        key: 'leader:key:2',
        value: Buffer.from('illegal-write-on-follower'),
        runId: 'run-l2',
        clientId: 'client-1',
        requestId: 'req-l2',
        operationId: 'op-l2'
      })
    ).rejects.toThrow(NotLeaderError);
  });

  it('prevents split-brain by fencing stale leader writes when new leader ascends to higher epoch', async () => {
    // 1. Partition occurs: Node B ascends to leadership with Epoch 2
    nodeB.engine.fencingCoordinator.acquireLeadership('node-b', 2);
    expect(nodeB.engine.fencingCoordinator.getEpoch()).toBe(2);
    expect(nodeB.engine.fencingCoordinator.isLeader('node-b')).toBe(true);

    // 2. Node B commits write with Epoch 2 and replicates to Node C
    const putB = await nodeB.engine.put({
      key: 'leader:key:epoch2',
      value: Buffer.from('epoch-2-data'),
      runId: 'run-l3',
      clientId: 'client-2',
      requestId: 'req-l3',
      operationId: 'op-l3'
    });
    expect(putB.replicationResult?.totalReplicaAcks).toBeGreaterThanOrEqual(2);

    // Node C now knows Epoch 2
    expect(nodeC.engine.fencingCoordinator.getEpoch()).toBe(2);

    // 3. Stale leader Node A (isolated, still believing it is Epoch 1) attempts to replicate to Node C
    const staleReplication = await nodeA.engine.peerPool.replicateToPeer({
      peerNodeId: 'node-c',
      sourceNodeId: 'node-a',
      key: 'leader:stale:key',
      entry: {
        value: Buffer.from('stale-leader-write'),
        tombstone: false,
        version: putB.version
      },
      operationId: 'op-stale-1',
      requestId: 'req-stale-1',
      membership: nodeA.runtime.getMembership(),
      fencingEpoch: 1 // Old epoch!
    });

    // Node C must have rejected the write with fencing violation
    expect(staleReplication.replicaAcked).toBe(false);
    expect(staleReplication.error).toMatch(/Fencing violation/);

    // Node C's storage must NOT have the stale key
    expect(nodeC.engine.get({ key: 'leader:stale:key' }).keyState.entries).toHaveLength(0);
  });

  it('supports 2-phase PrepareWrite and CommitWrite RPCs with fencing checks', async () => {
    // 1. Stale prepare with epoch 1 on node-c (at epoch 2) is rejected
    const stalePrepare = await nodeA.engine.peerPool.prepareWriteOnPeer({
      peerNodeId: 'node-c',
      key: '2pc:key:1',
      value: Buffer.from('val-2pc'),
      epoch: 1,
      leaderId: 'node-a'
    });
    expect(stalePrepare.status).toBe(ProtoStatusCode.STATUS_CODE_FENCED);

    // 2. Valid prepare with epoch 3 on node-c is accepted
    const validPrepare = await nodeB.engine.peerPool.prepareWriteOnPeer({
      peerNodeId: 'node-c',
      key: '2pc:key:1',
      value: Buffer.from('val-2pc'),
      epoch: 3,
      leaderId: 'node-b'
    });
    expect(validPrepare.status).toBe(ProtoStatusCode.STATUS_CODE_OK);

    // Node C has not yet committed the key to its visible store
    expect(nodeC.engine.get({ key: '2pc:key:1' }).keyState.entries).toHaveLength(0);

    // 3. CommitWrite with epoch 3 commits the staged value
    const validCommit = await nodeB.engine.peerPool.commitWriteOnPeer({
      peerNodeId: 'node-c',
      key: '2pc:key:1',
      epoch: 3,
      leaderId: 'node-b'
    });
    expect(validCommit.status).toBe(ProtoStatusCode.STATUS_CODE_OK);

    // Node C's visible store now contains the committed value
    const committedState = nodeC.engine.get({ key: '2pc:key:1' });
    expect(committedState.keyState.entries).toHaveLength(1);
    expect(Buffer.from(committedState.keyState.entries[0]!.value as Uint8Array).toString()).toBe('val-2pc');
  });

  it('refuses client writes when leader lease expires without renewal', async () => {
    // Node B is leader. Set lease to already expired time
    nodeB.engine.fencingCoordinator.stepDown(); // expire lease
    nodeB.engine.fencingCoordinator.acquireLeadership('node-b', 4, -100); // negative lease duration = expired immediately

    await expect(
      nodeB.engine.put({
        key: 'unsafe:key:1',
        value: Buffer.from('unsafe-data'),
        runId: 'run-unsafe',
        clientId: 'client-1',
        requestId: 'req-unsafe',
        operationId: 'op-unsafe'
      })
    ).rejects.toThrow(UnsafeLeaderError);
  });
});
