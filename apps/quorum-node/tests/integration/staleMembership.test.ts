import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { QuorumNodeApp } from '../../src/app.js';
import { PROTO_DIR } from '@quorum-lab/protocol';

const TEST_STALE_DIR = path.resolve('./tests/tmp-stale-cluster');

describe('QuorumNode Integration: Stale Membership Rejection (§Q0, §Q2)', () => {
  let app: QuorumNodeApp;
  let port: number;
  let nodeClient: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_STALE_DIR)) {
      await fs.promises.rm(TEST_STALE_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_STALE_DIR, { recursive: true });

    app = new QuorumNodeApp({
      node: {
        id: 'node-a',
        clusterId: 'cluster-stale',
        dataDir: TEST_STALE_DIR,
        grpcPort: 0,
        grpcHost: '127.0.0.1'
      },
      cluster: {
        membershipVersion: 5,
        members: ['node-a', 'node-b']
      }
    });

    port = await app.start();

    const nodePackageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'node.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR]
    });
    const loadedNode = grpc.loadPackageDefinition(nodePackageDef) as any;
    nodeClient = new loadedNode.quorum.node.v1.NodeService(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure()
    );
  });

  afterAll(async () => {
    if (nodeClient) nodeClient.close();
    await app.stop();
    if (fs.existsSync(TEST_STALE_DIR)) {
      await fs.promises.rm(TEST_STALE_DIR, { recursive: true, force: true });
    }
  });

  it('rejects Replicate RPC with obsolete/mismatched membership hash as STATUS_CODE_STALE_MEMBERSHIP', async () => {
    const repResp: any = await new Promise((resolve, reject) => {
      nodeClient.Replicate(
        {
          operation_id: 'op-stale',
          request_id: 'req-stale',
          source_node: 'node-stale',
          key: 'key-stale',
          entry: {
            value: Buffer.from('val'),
            tombstone: false,
            version: {
              dot: { node_id: 'node-stale', counter: 1 },
              vector_clock: { entries: {} },
              lamport: 1,
              wall_time_ms: 1000
            }
          },
          membership_version: 1, // Stale version
          membership_hash: '0000000000000000000000000000000000000000000000000000000000000000' // Invalid hash
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(repResp.status.code).toBe('STATUS_CODE_STALE_MEMBERSHIP');
    expect(repResp.status.message).toContain('Stale membership');
    expect(repResp.durable_acked).toBe(false);
  });
});
