import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import {
  ClientSessionContext,
  SessionGuaranteeVerifier,
  createVersionStamp
} from '@quorum-lab/consistency';
import { SessionRouter } from '@quorum-lab/replication';

const TEST_BASE_DIR = path.resolve('./tests/tmp-session-cluster');

describe('QuorumNode: Session Guarantees & Monotonic Reads (§Q7)', () => {
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
          clusterId: 'cluster-session',
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
          clusterId: 'cluster-session',
          dataDir: path.join(TEST_BASE_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'QUORUM', quorumConfig: { W: 1, R: 1 } }
    );

    nodeC = new QuorumNodeApp(
      {
        node: {
          id: 'node-c',
          clusterId: 'cluster-session',
          dataDir: path.join(TEST_BASE_DIR, 'node-c'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'QUORUM', quorumConfig: { W: 1, R: 1 } }
    );

    portA = await nodeA.start();
    portB = await nodeB.start();
    portC = await nodeC.start();

    // Cross-register peers for distributed reads
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

  it('guarantees Read-Your-Writes (RYW) across replicas using session token', async () => {
    const session = new ClientSessionContext('client-ryw-1');

    // 1. Client writes to node A
    const putRes = await nodeA.engine.put({
      key: 'user:100:profile',
      value: Buffer.from('profile-v1'),
      runId: 'run-s1',
      clientId: session.sessionId,
      requestId: 'req-w1',
      operationId: 'op-w1'
    });

    // Record write into session
    session.recordWrite(putRes.version);
    const token = session.encodeToken();
    expect(token).toBeDefined();

    // Invariant: node B has not received replication yet (W=1, R=1 asynchronous)
    const rawB = nodeB.engine.get({ key: 'user:100:profile' });
    expect(rawB.keyState.entries).toHaveLength(0);

    // 2. Client queries lagging node B with session token dependency
    const sessionB = ClientSessionContext.decodeToken(token);
    const readB = await nodeB.engine.distributedGet({
      key: 'user:100:profile',
      causalDependency: sessionB.getFrontier()
    });

    // Node B queried node A because local state did not satisfy the session token
    expect(readB.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readB.keyState.entries[0]!.value as Uint8Array).toString()).toBe('profile-v1');

    // Verify through SessionGuaranteeVerifier
    expect(SessionGuaranteeVerifier.verifyReadYourWrites(sessionB, readB.frontier)).toBe(true);
  });

  it('enforces Monotonic Reads (MR) preventing time-travel backward on lagging replicas', async () => {
    const session = new ClientSessionContext('client-mr-1');

    // 1. Write v1 to node A and node B
    await nodeA.engine.put({
      key: 'doc:report:metrics',
      value: Buffer.from('metrics-v1'),
      runId: 'run-s2',
      clientId: 'writer-1',
      requestId: 'req-mr-1',
      operationId: 'op-mr-1'
    });

    // 2. Write v2 to node A only
    await nodeA.engine.put({
      key: 'doc:report:metrics',
      value: Buffer.from('metrics-v2'),
      runId: 'run-s2',
      clientId: 'writer-1',
      requestId: 'req-mr-2',
      operationId: 'op-mr-2'
    });

    // 3. Client reads from node A and observes v2
    const readA = await nodeA.engine.distributedGet({ key: 'doc:report:metrics' });
    session.recordRead(readA.frontier);
    const token = session.encodeToken();

    // Node B has neither v1 nor v2 in its local store
    expect(nodeB.engine.get({ key: 'doc:report:metrics' }).keyState.entries).toHaveLength(0);

    // 4. Client reads from node B with session token
    const decodedSession = ClientSessionContext.decodeToken(token);
    const readB = await nodeB.engine.distributedGet({
      key: 'doc:report:metrics',
      causalDependency: decodedSession.getFrontier()
    });

    // Must return v2, never empty or stale
    expect(readB.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readB.keyState.entries[0]!.value as Uint8Array).toString()).toBe('metrics-v2');

    // Verifier checks that candidate frontier monotonically extends previous read
    expect(SessionGuaranteeVerifier.verifyMonotonicReads(decodedSession, readB.frontier)).toBe(true);
  });

  it('validates Monotonic Writes (MW) and Writes-Follow-Reads (WFR)', () => {
    const session = new ClientSessionContext('client-mw-wfr');

    const v1 = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      lamport: 100,
      wallTimeMs: 1000,
      vectorClock: { 'node-a': 1 }
    });
    session.recordWrite(v1);

    // Valid subsequent write
    const v2 = createVersionStamp({
      nodeId: 'node-a',
      counter: 2,
      lamport: 200,
      wallTimeMs: 1005,
      vectorClock: { 'node-a': 2 }
    });
    expect(SessionGuaranteeVerifier.verifyMonotonicWrites(session, v2)).toBe(true);

    // Invalid stale write attempt
    const vStale = createVersionStamp({
      nodeId: 'node-a',
      counter: 0,
      lamport: 50,
      wallTimeMs: 900,
      vectorClock: { 'node-a': 0 }
    });
    expect(SessionGuaranteeVerifier.verifyMonotonicWrites(session, vStale)).toBe(false);

    // Writes-Follow-Reads verification
    session.recordRead({
      maximalVersions: [v2]
    });
    const vFollows = createVersionStamp({
      nodeId: 'node-b',
      counter: 1,
      lamport: 250,
      wallTimeMs: 1010,
      vectorClock: { 'node-a': 2, 'node-b': 1 }
    });
    expect(SessionGuaranteeVerifier.verifyWritesFollowReads(session, vFollows)).toBe(true);
  });

  it('routes client requests via SessionRouter with sticky affinity and failover', () => {
    const router = new SessionRouter({
      clusterNodes: ['node-a', 'node-b', 'node-c'],
      stickyAffinity: true
    });

    const session1 = 'session-user-alpha';
    const primaryNode = router.getReplicaForSession(session1);
    expect(['node-a', 'node-b', 'node-c']).toContain(primaryNode);

    // Repeated calls return the exact same node (sticky affinity)
    for (let i = 0; i < 5; i++) {
      expect(router.getReplicaForSession(session1)).toBe(primaryNode);
    }

    // Mark primary replica degraded
    router.markReplicaHealth(primaryNode, false);

    // Failover selects a different healthy replica
    const failoverNode = router.getReplicaForSession(session1);
    expect(failoverNode).not.toBe(primaryNode);
    expect(['node-a', 'node-b', 'node-c']).toContain(failoverNode);

    // Once primary node recovers, it remains stable or returns gracefully
    router.markReplicaHealth(primaryNode, true);
    const recoveredNode = router.getReplicaForSession(session1);
    expect(['node-a', 'node-b', 'node-c']).toContain(recoveredNode);
  });
});
