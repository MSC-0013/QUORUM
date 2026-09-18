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

    // 7. Test execute run idempotency and state transition
    const execRes1 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/execute`,
      headers: { 'idempotency-key': 'exec-test-key-1' },
      payload: {
        executionId: 'exec-test-1',
        artifact: {
          uri: 'minio://artifacts/traces/test.json',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          mediaType: 'application/json'
        },
        options: { durationMs: 10000, concurrency: 4 }
      }
    });
    expect(execRes1.statusCode).toBe(202);
    const execRun1 = JSON.parse(execRes1.body);
    expect(execRun1.status).toBe('EXECUTION_REQUESTED');
    expect(execRun1.executionId).toBe('exec-test-1');
    expect(execRun1.artifact.uri).toBe('minio://artifacts/traces/test.json');

    // Idempotent retry with same idempotency key must succeed and return same run
    const execRes2 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/execute`,
      headers: { 'idempotency-key': 'exec-test-key-1' },
      payload: { executionId: 'exec-test-1' }
    });
    expect(execRes2.statusCode).toBe(202);
    expect(JSON.parse(execRes2.body).status).toBe('EXECUTION_REQUESTED');

    // 8. Update run status to RUNNING by worker
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/runs/${run.id}`,
      payload: {
        status: 'RUNNING',
        startedAt: new Date().toISOString()
      }
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).status).toBe('RUNNING');

    // 9. Cancel run
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/cancel`,
      payload: { reason: 'User requested abort' }
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelledRun = JSON.parse(cancelRes.body);
    expect(cancelledRun.status).toBe('CANCELLED');
    expect(cancelledRun.cancelReason).toBe('User requested abort');
  });
});
