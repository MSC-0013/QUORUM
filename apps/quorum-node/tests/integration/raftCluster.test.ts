import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import { NotLeaderError } from '@quorum-lab/replication';

const TEST_BASE_DIR = path.resolve('./tests/tmp-raft-cluster');

describe('QuorumNode: Raft Consensus Cluster Integration (§Q9)', () => {
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

    nodeA = new QuorumNodeApp(
      {
        node: {
          id: 'node-a',
          clusterId: 'cluster-raft',
          dataDir: path.join(TEST_BASE_DIR, 'node-a'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'RAFT',
        raftConfig: {
          initialTerm: 0,
          initialRole: 'FOLLOWER'
        }
      }
    );

    nodeB = new QuorumNodeApp(
      {
        node: {
          id: 'node-b',
          clusterId: 'cluster-raft',
          dataDir: path.join(TEST_BASE_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'RAFT',
        raftConfig: {
          initialTerm: 0,
          initialRole: 'FOLLOWER'
        }
      }
    );

    nodeC = new QuorumNodeApp(
      {
        node: {
          id: 'node-c',
          clusterId: 'cluster-raft',
          dataDir: path.join(TEST_BASE_DIR, 'node-c'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'RAFT',
        raftConfig: {
          initialTerm: 0,
          initialRole: 'FOLLOWER'
        }
      }
    );

    portA = await nodeA.start();
    portB = await nodeB.start();
    portC = await nodeC.start();

    // Cross-register peer gRPC addresses
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

  it('elects Node A as Raft leader via gRPC RequestVote RPCs', async () => {
    const elected = await nodeA.engine.raftNode.startElection(1);
    expect(elected).toBe(true);
    expect(nodeA.engine.raftNode.isLeader()).toBe(true);
    expect(nodeA.engine.raftNode.currentTerm).toBe(1);
  });

  it('replicates mutations through Raft consensus and applies to all replicas', async () => {
    const putRes = await nodeA.engine.put({
      key: 'raft:key:alpha',
      value: Buffer.from('raft-value-alpha'),
      runId: 'run-r1',
      clientId: 'client-1',
      requestId: 'req-r1',
      operationId: 'op-r1'
    });

    expect(putRes.version.dot.counter).toBeGreaterThan(0);

    // Leader committed and applied
    const stateA = nodeA.engine.get({ key: 'raft:key:alpha' });
    expect(stateA.keyState.entries).toHaveLength(1);
    expect(Buffer.from(stateA.keyState.entries[0]!.value as Uint8Array).toString()).toBe('raft-value-alpha');

    // Follower B received and applied through commit propagation
    const stateB = nodeB.engine.get({ key: 'raft:key:alpha' });
    expect(stateB.keyState.entries).toHaveLength(1);
    expect(Buffer.from(stateB.keyState.entries[0]!.value as Uint8Array).toString()).toBe('raft-value-alpha');

    // Follower C received and applied through commit propagation
    const stateC = nodeC.engine.get({ key: 'raft:key:alpha' });
    expect(stateC.keyState.entries).toHaveLength(1);
    expect(Buffer.from(stateC.keyState.entries[0]!.value as Uint8Array).toString()).toBe('raft-value-alpha');

    // All logs have index 1 at term 1
    expect(nodeA.engine.raftNode.log.lastIndex()).toBe(1);
    expect(nodeB.engine.raftNode.log.lastIndex()).toBe(1);
    expect(nodeC.engine.raftNode.log.lastIndex()).toBe(1);
  });

  it('rejects client mutations on follower nodes with NotLeaderError', async () => {
    await expect(
      nodeB.engine.put({
        key: 'raft:key:forbidden',
        value: Buffer.from('reject-me'),
        runId: 'run-r2',
        clientId: 'client-1',
        requestId: 'req-r2',
        operationId: 'op-r2'
      })
    ).rejects.toThrow(NotLeaderError);
  });

  it('supports failover when leader is partitioned and new leader is elected', async () => {
    // Step down Node A and simulate partition by stepping it down to follower
    nodeA.engine.raftNode.stepDown(1);
    expect(nodeA.engine.raftNode.isLeader()).toBe(false);

    // Node B campaigns for term 2 and receives vote from Node C
    const electedB = await nodeB.engine.raftNode.startElection(2);
    expect(electedB).toBe(true);
    expect(nodeB.engine.raftNode.isLeader()).toBe(true);
    expect(nodeB.engine.raftNode.currentTerm).toBe(2);

    // Propose new write via new leader Node B
    const putB = await nodeB.engine.put({
      key: 'raft:key:failover',
      value: Buffer.from('replicated-under-term-2'),
      runId: 'run-r3',
      clientId: 'client-2',
      requestId: 'req-r3',
      operationId: 'op-r3'
    });

    expect(putB.version.dot.counter).toBeGreaterThan(0);

    // Key exists on new leader Node B and follower Node C
    const readB = nodeB.engine.get({ key: 'raft:key:failover' });
    expect(readB.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readB.keyState.entries[0]!.value as Uint8Array).toString()).toBe('replicated-under-term-2');

    const readC = nodeC.engine.get({ key: 'raft:key:failover' });
    expect(readC.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readC.keyState.entries[0]!.value as Uint8Array).toString()).toBe('replicated-under-term-2');
  });

  it('compacts Raft consensus log without disturbing KV state machine', async () => {
    // Current log has entries at index 1 and 2
    expect(nodeB.engine.raftNode.log.lastIndex()).toBe(2);

    // Compact Raft log up to index 1
    nodeB.engine.raftNode.log.compact(1, 1);

    // Log index 1 is now compacted, entry 1 should no longer be in memory log
    expect(nodeB.engine.raftNode.log.getEntry(1)).toBeUndefined();
    // Entry 2 is still retained
    expect(nodeB.engine.raftNode.log.getEntry(2)).toBeDefined();
    expect(nodeB.engine.raftNode.log.lastIndex()).toBe(2);

    // KV state machine remains intact and queryable
    const readAlpha = nodeB.engine.get({ key: 'raft:key:alpha' });
    expect(readAlpha.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readAlpha.keyState.entries[0]!.value as Uint8Array).toString()).toBe('raft-value-alpha');
  });
});
