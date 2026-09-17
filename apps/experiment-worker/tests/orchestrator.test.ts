import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '@quorum-lab/quorum-node';
import { ExperimentOrchestrator } from '../src/index.js';

const TEST_BASE_DIR = path.resolve('./tests/tmp-worker-cluster');

describe('ExperimentWorker: End-to-End Orchestrator Integration (§Q4)', () => {
  let nodeCoord: QuorumNodeApp;
  let nodePeer: QuorumNodeApp;
  let portCoord: number;
  let portPeer: number;

  beforeAll(async () => {
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_BASE_DIR, { recursive: true });

    const clusterConfig = {
      membershipVersion: 1,
      members: ['node-coord', 'node-peer']
    };

    nodeCoord = new QuorumNodeApp(
      {
        node: {
          id: 'node-coord',
          clusterId: 'cluster-exp',
          dataDir: path.join(TEST_BASE_DIR, 'node-coord'),
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: clusterConfig
      },
      {
        replicationMode: 'QUORUM',
        quorumConfig: { W: 2, R: 1 },
        durabilityMode: 'SYNC_FSYNC'
      }
    );

    nodePeer = new QuorumNodeApp(
      {
        node: {
          id: 'node-peer',
          clusterId: 'cluster-exp',
          dataDir: path.join(TEST_BASE_DIR, 'node-peer'),
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

    portCoord = await nodeCoord.start();
    portPeer = await nodePeer.start();

    nodeCoord.engine.peerPool.registerPeer({
      nodeId: 'node-peer',
      address: `127.0.0.1:${portPeer}`
    });
  });

  afterAll(async () => {
    await Promise.all([nodeCoord.stop(), nodePeer.stop()]);
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('orchestrates workload under scheduled timeline faults and verifies cleanup', async () => {
    const orchestrator = new ExperimentOrchestrator();

    const report = await orchestrator.execute({
      runId: 'exp-run-q4',
      rootSeed: 'reproducible-seed-q4',
      coordinatorAddress: `127.0.0.1:${portCoord}`,
      nodeAddresses: {
        'node-coord': `127.0.0.1:${portCoord}`,
        'node-peer': `127.0.0.1:${portPeer}`
      },
      workload: {
        keyCount: 5,
        operationsTotal: 15,
        readRatio: 0.5,
        writeRatio: 0.5,
        distribution: 'ZIPFIAN'
      },
      faultTimeline: [
        {
          offsetMs: 5,
          action: 'SET_FAULT',
          durationMs: 30,
          rule: {
            faultId: 'delay-node-peer',
            type: 'DELAY',
            scope: 'NODE_TO_NODE',
            targetNodeId: 'node-coord',
            peerNodeId: 'node-peer',
            delayMs: 10
          }
        }
      ]
    });

    expect(report.runId).toBe('exp-run-q4');
    expect(report.summary.totalOperations).toBe(15);
    expect(report.summary.successfulOperations).toBeGreaterThan(0);
    expect(report.summary.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.summary.traces).toHaveLength(15);

    // Invariant: all injected faults must be cleaned up across all nodes after execution
    expect(nodeCoord.faultRegistry.getActiveRules()).toHaveLength(0);
    expect(nodePeer.faultRegistry.getActiveRules()).toHaveLength(0);
  });
});
