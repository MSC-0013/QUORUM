import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import { findDifferingBuckets, keyToBucket } from '@quorum-lab/repair';

const TEST_BASE_DIR = path.resolve('./tests/tmp-repair-cluster');

describe('QuorumNode Integration: Anti-Entropy, Repair & Hinted Handoff (§Q6)', () => {
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
          clusterId: 'cluster-repair',
          dataDir: path.join(TEST_BASE_DIR, 'node-a'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'QUORUM', quorumConfig: { W: 2, R: 2 } }
    );

    nodeB = new QuorumNodeApp(
      {
        node: {
          id: 'node-b',
          clusterId: 'cluster-repair',
          dataDir: path.join(TEST_BASE_DIR, 'node-b'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'QUORUM', quorumConfig: { W: 2, R: 2 } }
    );

    nodeC = new QuorumNodeApp(
      {
        node: {
          id: 'node-c',
          clusterId: 'cluster-repair',
          dataDir: path.join(TEST_BASE_DIR, 'node-c'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      { replicationMode: 'QUORUM', quorumConfig: { W: 2, R: 2 } }
    );

    portA = await nodeA.start();
    portB = await nodeB.start();
    portC = await nodeC.start();

    // Cross-register peers
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

  it('detects missing keys via Merkle tree comparison and reconciles via Repair RPC', async () => {
    // Write key exclusively to node-a locally
    const putRes = await nodeA.engine.mutationExecutor.execute({
      recordType: 0,
      key: 'sync:key-99',
      value: Buffer.from('merkle-sync-val'),
      runId: 'run-ae-1',
      clientId: 'client-ae',
      requestId: 'req-ae-1',
      operationId: 'op-ae-1'
    });

    const treeA = nodeA.engine.buildMerkleTree(16);
    const treeB = nodeB.engine.buildMerkleTree(16);

    expect(treeA.getRootHash()).not.toBe(treeB.getRootHash());

    const differing = findDifferingBuckets(treeA, treeB);
    const targetBucket = keyToBucket('sync:key-99', 16);
    expect(differing).toContain(targetBucket);

    // Apply repair to node-b using Repair RPC
    const clientForB = nodeA.engine.peerPool.getPeerClient('node-b');
    const repairResponse: any = await new Promise((resolve, reject) => {
      clientForB.Repair(
        {
          key: 'sync:key-99',
          entry: {
            value: Buffer.from('merkle-sync-val'),
            tombstone: false,
            version: {
              dot: { node_id: putRes.version.dot.nodeId, counter: putRes.version.dot.counter },
              vector_clock: { entries: putRes.version.vectorClock },
              lamport: putRes.version.lamport,
              wall_time_ms: putRes.version.wallTimeMs
            }
          }
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(repairResponse.status.code).toBe('STATUS_CODE_OK');

    // Both nodes now hold the key and their Merkle trees match!
    const updatedTreeB = nodeB.engine.buildMerkleTree(16);
    expect(nodeA.engine.buildMerkleTree(16).getRootHash()).toBe(updatedTreeB.getRootHash());
  });

  it('triggers asynchronous read repair when quorum read observes stale replica', async () => {
    // Write key to node-a directly and replicate to node-b, leaving node-c stale
    const putRes = await nodeA.engine.mutationExecutor.execute({
      recordType: 0,
      key: 'rr:key-1',
      value: Buffer.from('value-for-read-repair'),
      runId: 'run-rr',
      clientId: 'client-rr',
      requestId: 'req-rr-1',
      operationId: 'op-rr-1'
    });

    await nodeB.engine.applyReplicatedEntry({
      key: 'rr:key-1',
      entry: {
        value: Buffer.from('value-for-read-repair'),
        tombstone: false,
        version: putRes.version
      },
      operationId: 'op-rr-1',
      requestId: 'req-rr-1',
      sourceNode: 'node-a',
      membershipHash: nodeB.runtime.getMembership().hash,
      fencingEpoch: 0
    });

    // Verify node-c is currently missing the key
    const nodeCLocal = nodeC.engine.get({ key: 'rr:key-1' });
    expect(nodeCLocal.keyState.entries).toHaveLength(0);

    // Client performs quorum read from node-a with R=2 (queries node-a + peers)
    const readRes = await nodeA.engine.distributedGet({ key: 'rr:key-1' });
    expect(readRes.keyState.entries).toHaveLength(1);
    expect(Buffer.from(readRes.keyState.entries[0]?.value as Uint8Array).toString()).toBe('value-for-read-repair');

    // Wait for async read repair to converge node-c
    let converged = false;
    for (let i = 0; i < 20; i++) {
      const stateC = nodeC.engine.get({ key: 'rr:key-1' });
      if (stateC.keyState.entries.length > 0) {
        converged = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(converged).toBe(true);
    expect(nodeA.engine.readRepair.getMetrics().repairsTriggered).toBeGreaterThanOrEqual(1);
  });

  it('records hints when peer is partitioned and replays upon reconnection', async () => {
    // Record hint directly on node-a for temporarily unreachable node-b
    const hint = await nodeA.engine.hintedHandoff.storeHint({
      targetNodeId: 'node-b',
      key: 'hinted:key-42',
      entry: {
        value: Buffer.from('hinted-payload-42'),
        tombstone: false,
        version: nodeA.runtime.clocks.mintVersionStamp()
      },
      operationId: 'op-hint-42',
      requestId: 'req-hint-42'
    });

    expect(hint.key).toBe('hinted:key-42');
    expect(nodeA.engine.hintedHandoff.getMetrics().hintsPending).toBe(1);

    // Replay hints for node-b
    const replayRes = await nodeA.engine.replayHintsForPeer('node-b');
    expect(replayRes.replayed).toBe(1);
    expect(replayRes.failed).toBe(0);

    expect(nodeA.engine.hintedHandoff.getMetrics().hintsPending).toBe(0);

    // Verify node-b received and persisted the hinted write
    const nodeBEntry = nodeB.engine.get({ key: 'hinted:key-42' });
    expect(nodeBEntry.keyState.entries).toHaveLength(1);
    expect(Buffer.from(nodeBEntry.keyState.entries[0]?.value as Uint8Array).toString()).toBe('hinted-payload-42');
  });

  it('safely garbage collects tombstones only when certified across membership frontier', async () => {
    // Delete a key on node-a
    const delRes = await nodeA.engine.delete({
      key: 'gc:key-delete',
      clientId: 'client-gc',
      requestId: 'req-gc-1',
      operationId: 'op-gc-1',
      runId: 'run-gc'
    });

    expect(delRes.tombstoneVersion).toBeDefined();

    // Attempt GC sweep when node-b and node-c have not certified witnessing the deletion
    const uncertifiedFrontiers = new Map([
      ['node-a', { dotCounters: { 'node-a': delRes.tombstoneVersion.dot.counter } }],
      ['node-b', { dotCounters: { 'node-a': delRes.tombstoneVersion.dot.counter - 1 } }], // lagging behind!
      ['node-c', { dotCounters: { 'node-a': 0 } }]
    ]);

    const sweep1 = nodeA.engine.sweepTombstones({
      replicaFrontiers: uncertifiedFrontiers
    });
    expect(sweep1.prunedEntries).toBe(0);
    expect(nodeA.engine.get({ key: 'gc:key-delete' }).keyState.entries).toHaveLength(1); // Tombstone retained!

    // Now all nodes in cluster certify having witnessed the deletion
    const certifiedFrontiers = new Map([
      ['node-a', { dotCounters: { 'node-a': delRes.tombstoneVersion.dot.counter } }],
      ['node-b', { dotCounters: { 'node-a': delRes.tombstoneVersion.dot.counter } }],
      ['node-c', { dotCounters: { 'node-a': delRes.tombstoneVersion.dot.counter } }]
    ]);

    const sweep2 = nodeA.engine.sweepTombstones({
      replicaFrontiers: certifiedFrontiers
    });
    expect(sweep2.prunedEntries).toBe(1);
    expect(sweep2.purgedKeys).toContain('gc:key-delete');
    expect(nodeA.engine.get({ key: 'gc:key-delete' }).keyState.entries).toHaveLength(0); // Safely purged!
  });
});
