import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Control API - Endpoints CRUD & Experiment Lifecyle', () => {
  const app = buildApp();

  it('runs complete lifecycle: project -> cluster -> nodes -> policy -> experiment -> run', async () => {
    // 1. Create project
    const projRes = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: {
        name: 'Distributed Consistency Lab',
        description: 'Testing quorum intersection invariants'
      }
    });
    expect(projRes.statusCode).toBe(201);
    const project = JSON.parse(projRes.body);
    expect(project.id).toBeDefined();

    // 2. Create cluster
    const clusterRes = await app.inject({
      method: 'POST',
      url: '/v1/clusters',
      payload: {
        projectId: project.id,
        name: 'Cluster-Alpha',
        members: ['node-1', 'node-2', 'node-3'],
        policy: {
          replicationEngine: 'LEADERLESS',
          readConsistency: { mode: 'QUORUM' },
          writeAck: { mode: 'QUORUM' },
          localDurability: { mode: 'SYNC_FSYNC' },
          conflictStrategy: { mode: 'LAST_WRITE_WINS' }
        }
      }
    });
    expect(clusterRes.statusCode).toBe(201);
    const cluster = JSON.parse(clusterRes.body);
    expect(cluster.id).toBeDefined();
    expect(cluster.membershipHash).toBeDefined();

    // 3. Register nodes
    const nodeRes = await app.inject({
      method: 'POST',
      url: `/v1/clusters/${cluster.id}/nodes`,
      payload: {
        nodeId: 'node-1',
        grpcAddress: '127.0.0.1:50051'
      }
    });
    expect(nodeRes.statusCode).toBe(201);

    const listNodesRes = await app.inject({
      method: 'GET',
      url: `/v1/clusters/${cluster.id}/nodes`
    });
    expect(listNodesRes.statusCode).toBe(200);
    const nodes = JSON.parse(listNodesRes.body);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('node-1');

    // 4. Update policy to ONE read, ALL write
    const updatePolicyRes = await app.inject({
      method: 'POST',
      url: `/v1/clusters/${cluster.id}/policies`,
      payload: {
        policy: {
          replicationEngine: 'LEADERLESS',
          readConsistency: { mode: 'ONE' },
          writeAck: { mode: 'ALL' },
          localDurability: { mode: 'BATCHED_FSYNC' },
          conflictStrategy: { mode: 'LAST_WRITE_WINS' }
        }
      }
    });
    expect(updatePolicyRes.statusCode).toBe(200);
    const updatedCluster = JSON.parse(updatePolicyRes.body);
    expect(updatedCluster.resolvedQuorum.W).toBe(3);
    expect(updatedCluster.resolvedQuorum.R).toBe(1);
    expect(updatedCluster.resolvedQuorum.hasQuorumIntersection).toBe(true); // 3 + 1 > 3

    // 5. Create experiment
    const expRes = await app.inject({
      method: 'POST',
      url: '/v1/experiments',
      payload: {
        projectId: project.id,
        clusterId: cluster.id,
        name: 'Quorum vs Eventual Comparison',
        workload: {
          keyCount: 50,
          operationsTotal: 500,
          readRatio: 0.5,
          writeRatio: 0.5,
          distribution: 'UNIFORM'
        },
        faultTimeline: [
          { offsetMs: 1000, type: 'NETWORK_PARTITION', targetNodeId: 'node-3' }
        ]
      }
    });
    expect(expRes.statusCode).toBe(201);
    const exp = JSON.parse(expRes.body);
    expect(exp.id).toBeDefined();

    // 6. Queue experiment run
    const runRes = await app.inject({
      method: 'POST',
      url: `/v1/experiments/${exp.id}/runs`,
      payload: {
        rootSeed: 'custom-deterministic-seed-42'
      }
    });
    expect(runRes.statusCode).toBe(201);
    const run = JSON.parse(runRes.body);
    expect(run.status).toBe('QUEUED');
    expect(run.rootSeed).toBe('custom-deterministic-seed-42');
    // Policy and membership must be snapshotted
    expect(run.clusterPolicySnapshot.writeAck.mode).toBe('ALL');
    expect(run.clusterPolicySnapshot.readConsistency.mode).toBe('ONE');
    expect(run.membershipSnapshot.members).toEqual(['node-1', 'node-2', 'node-3']);

    // 7. Update run status by worker
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/runs/${run.id}`,
      payload: {
        status: 'COMPLETED',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        result: {
          totalOperations: 500,
          successfulOperations: 480,
          failedOperations: 20,
          divergenceDetected: false,
          anomaliesFound: []
        }
      }
    });
    expect(patchRes.statusCode).toBe(200);
    const completedRun = JSON.parse(patchRes.body);
    expect(completedRun.status).toBe('COMPLETED');
    expect(completedRun.result.divergenceDetected).toBe(false);
  });
});
