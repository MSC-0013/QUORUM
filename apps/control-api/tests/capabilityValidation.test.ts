import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Control API - Capability Validation & Milestone Gate', () => {
  const app = buildApp();

  it('rejects Raft engine with 422 FEATURE_NOT_AVAILABLE_IN_MILESTONE under Q3', async () => {
    // 1. Create a project first
    const projRes = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'Test Proj' }
    });
    const proj = JSON.parse(projRes.body);

    // 2. Attempt to create cluster with RAFT
    const clusterRes = await app.inject({
      method: 'POST',
      url: '/v1/clusters',
      payload: {
        projectId: proj.id,
        name: 'Raft Cluster',
        members: ['node-1', 'node-2', 'node-3'],
        policy: {
          replicationEngine: 'RAFT',
          readConsistency: { mode: 'QUORUM' },
          writeAck: { mode: 'QUORUM' },
          localDurability: { mode: 'SYNC_FSYNC' },
          conflictStrategy: { mode: 'LAST_WRITE_WINS' }
        }
      }
    });

    expect(clusterRes.statusCode).toBe(422);
    const body = JSON.parse(clusterRes.body);
    expect(body.error).toBe('FEATURE_NOT_AVAILABLE_IN_MILESTONE');
    expect(body.firstValidMilestone).toBe('Q9');
  });

  it('rejects LEADER engine with 422 FEATURE_NOT_AVAILABLE_IN_MILESTONE under Q3', async () => {
    const projRes = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'Test Proj 2' }
    });
    const proj = JSON.parse(projRes.body);

    const clusterRes = await app.inject({
      method: 'POST',
      url: '/v1/clusters',
      payload: {
        projectId: proj.id,
        name: 'Leader Cluster',
        members: ['node-1', 'node-2', 'node-3'],
        policy: {
          replicationEngine: 'LEADER',
          readConsistency: { mode: 'QUORUM' },
          writeAck: { mode: 'QUORUM' },
          localDurability: { mode: 'SYNC_FSYNC' },
          conflictStrategy: { mode: 'LAST_WRITE_WINS' }
        }
      }
    });

    expect(clusterRes.statusCode).toBe(422);
    const body = JSON.parse(clusterRes.body);
    expect(body.error).toBe('FEATURE_NOT_AVAILABLE_IN_MILESTONE');
    expect(body.firstValidMilestone).toBe('Q8');
  });

  it('rejects VERSION_VECTOR conflict strategy with 422 under Q3', async () => {
    const projRes = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'Test Proj 3' }
    });
    const proj = JSON.parse(projRes.body);

    const clusterRes = await app.inject({
      method: 'POST',
      url: '/v1/clusters',
      payload: {
        projectId: proj.id,
        name: 'VV Cluster',
        members: ['node-1', 'node-2', 'node-3'],
        policy: {
          replicationEngine: 'LEADERLESS',
          readConsistency: { mode: 'QUORUM' },
          writeAck: { mode: 'QUORUM' },
          localDurability: { mode: 'SYNC_FSYNC' },
          conflictStrategy: { mode: 'VERSION_VECTOR' }
        }
      }
    });

    expect(clusterRes.statusCode).toBe(422);
    const body = JSON.parse(clusterRes.body);
    expect(body.error).toBe('FEATURE_NOT_AVAILABLE_IN_MILESTONE');
    expect(body.firstValidMilestone).toBe('Q5');
  });

  it('accepts valid Q3 policy configuration and calculates quorum numbers', async () => {
    const projRes = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'Valid Proj' }
    });
    const proj = JSON.parse(projRes.body);

    const clusterRes = await app.inject({
      method: 'POST',
      url: '/v1/clusters',
      payload: {
        projectId: proj.id,
        name: 'Quorum Cluster',
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
    expect(cluster.resolvedQuorum).toEqual({
      N: 3,
      W: 2,
      R: 2,
      hasQuorumIntersection: true
    });
  });
});
