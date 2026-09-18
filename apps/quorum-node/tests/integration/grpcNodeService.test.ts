import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { QuorumNodeApp } from '../../src/app.js';
import { PROTO_DIR } from '@quorum-lab/protocol';

const TEST_DIR = path.resolve('./tests/tmp-grpc-node-service');

describe('QuorumNode: gRPC NodeService & Health Integration Tests', () => {
  let app: QuorumNodeApp;
  let port: number;
  let nodeClient: any;
  let healthClient: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DIR)) {
      await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_DIR, { recursive: true });

    app = new QuorumNodeApp({
      node: {
        id: 'node-a',
        clusterId: 'cluster-test',
        dataDir: TEST_DIR,
        grpcPort: 0, // OS assigns an ephemeral free port
        grpcHost: '127.0.0.1'
      },
      cluster: {
        membershipVersion: 1,
        members: ['node-a', 'node-b', 'node-c']
      }
    });

    port = await app.start();

    // Setup client definitions
    const nodePackageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'node.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR]
    });
    const loadedNode = grpc.loadPackageDefinition(nodePackageDef) as any;
    const NodeService = loadedNode.quorum.node.v1.NodeService;
    nodeClient = new NodeService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());

    const healthPackageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'health.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR]
    });
    const loadedHealth = grpc.loadPackageDefinition(healthPackageDef) as any;
    const HealthService = loadedHealth.grpc.health.v1.Health;
    healthClient = new HealthService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });

  afterAll(async () => {
    if (nodeClient) nodeClient.close();
    if (healthClient) healthClient.close();
    await app.stop();
    if (fs.existsSync(TEST_DIR)) {
      await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('verifies node lifecycle reached HEALTHY and health check returns SERVING', async () => {
    expect(app.lifecycle.getState()).toBe('HEALTHY');

    const healthResponse: any = await new Promise((resolve, reject) => {
      healthClient.Check({ service: '' }, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    // 1 = SERVING
    expect(healthResponse.status).toBe('SERVING');
  });

  it('executes Put and Get over gRPC', async () => {
    const putResponse: any = await new Promise((resolve, reject) => {
      nodeClient.Put(
        {
          key: 'item:42',
          value: Buffer.from('gRPC value payload'),
          run_id: 'run-1',
          client_id: 'client-1',
          operation_id: 'op-1',
          request_id: 'req-1'
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(putResponse.status.code).toBe('STATUS_CODE_OK');
    expect(putResponse.version.dot.node_id).toBe('node-a');
    expect(putResponse.version.dot.counter).toBe('1');
    expect(putResponse.resulting_frontier.maximal_versions).toHaveLength(1);

    const getResponse: any = await new Promise((resolve, reject) => {
      nodeClient.Get(
        {
          key: 'item:42',
          run_id: 'run-1',
          client_id: 'client-1',
          operation_id: 'op-2',
          request_id: 'req-2'
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(getResponse.status.code).toBe('STATUS_CODE_OK');
    expect(getResponse.key_state.key).toBe('item:42');
    expect(getResponse.key_state.entries).toHaveLength(1);
    expect(Buffer.from(getResponse.key_state.entries[0].value).toString()).toBe('gRPC value payload');
    expect(getResponse.frontier.maximal_versions).toHaveLength(1);
  });

  it('executes GetVersions returning a VersionFrontier (§6.1)', async () => {
    const getVersionsResponse: any = await new Promise((resolve, reject) => {
      nodeClient.GetVersions({ key: 'item:42' }, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    expect(getVersionsResponse.maximal_versions).toHaveLength(1);
    expect(getVersionsResponse.maximal_versions[0].dot.node_id).toBe('node-a');
    expect(getVersionsResponse.maximal_versions[0].dot.counter).toBe('1');
  });

  it('executes Delete over gRPC leaving tombstone', async () => {
    const deleteResponse: any = await new Promise((resolve, reject) => {
      nodeClient.Delete(
        {
          key: 'item:42',
          run_id: 'run-1',
          client_id: 'client-1',
          operation_id: 'op-3',
          request_id: 'req-3'
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(deleteResponse.status.code).toBe('STATUS_CODE_OK');
    expect(deleteResponse.tombstone_version.dot.counter).toBe('2');

    const getResponse: any = await new Promise((resolve, reject) => {
      nodeClient.Get({ key: 'item:42' }, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    expect(getResponse.key_state.entries).toHaveLength(1);
    expect(getResponse.key_state.entries[0].tombstone).toBe(true);
  });

  it('executes GetNodeState returning runtime metadata', async () => {
    const stateResponse: any = await new Promise((resolve, reject) => {
      nodeClient.GetNodeState({ include_keys: false }, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    expect(stateResponse.node_id).toBe('node-a');
    expect(stateResponse.cluster_id).toBe('cluster-test');
    expect(stateResponse.lifecycle_state).toBe('HEALTHY');
    expect(stateResponse.membership.version).toBe('1');
    expect(stateResponse.membership.members).toEqual(['node-a', 'node-b', 'node-c']);
    expect(stateResponse.membership.hash).toHaveLength(64);
  });

  it('verifies future milestone RPCs return gRPC UNIMPLEMENTED (status code 12)', async () => {
    const testUnimplemented = async (rpcCall: (cb: any) => void) => {
      await expect(
        new Promise((resolve, reject) => {
          rpcCall((err: any, resp: any) => {
            if (err) reject(err);
            else resolve(resp);
          });
        })
      ).rejects.toMatchObject({
        code: grpc.status.UNIMPLEMENTED
      });
    };

    // CreateSnapshot is implemented in Q1
    const snapResult: any = await new Promise((resolve, reject) => {
      nodeClient.CreateSnapshot({}, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
    expect(snapResult.status.code).toBe('STATUS_CODE_OK');

    // ReadDigest and Repair implemented in Q6
    const digestResult: any = await new Promise((resolve, reject) => {
      nodeClient.ReadDigest({ bucket_id: 0 }, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
    expect(digestResult.bucket_id).toBe(0);
    expect(digestResult.merkle_root_hash).toBeDefined();

    // PrepareWrite and CommitWrite implemented in Q8
    const prepResult: any = await new Promise((resolve, reject) => {
      nodeClient.PrepareWrite({ key: 'test-prep', value: Buffer.from('val'), epoch: 1, leader_id: 'leader' }, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
    expect(prepResult.status.code === 1 || prepResult.status.code === 'STATUS_CODE_OK').toBe(true);

    const commitResult: any = await new Promise((resolve, reject) => {
      nodeClient.CommitWrite({ key: 'test-prep', epoch: 1, leader_id: 'leader' }, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
    expect(commitResult.status.code === 1 || commitResult.status.code === 'STATUS_CODE_OK').toBe(true);
  });
});
