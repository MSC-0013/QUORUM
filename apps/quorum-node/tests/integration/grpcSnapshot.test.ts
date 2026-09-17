import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { QuorumNodeApp } from '../../src/app.js';
import { PROTO_DIR } from '@quorum-lab/protocol';

const SNAP_TEST_DIR = path.resolve('./tests/tmp-grpc-snap');

describe('QuorumNode Integration: gRPC CreateSnapshot & Idempotency (§9, §Q1)', () => {
  let app: QuorumNodeApp;
  let port: number;
  let nodeClient: any;

  beforeAll(async () => {
    if (fs.existsSync(SNAP_TEST_DIR)) {
      await fs.promises.rm(SNAP_TEST_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(SNAP_TEST_DIR, { recursive: true });

    app = new QuorumNodeApp({
      node: {
        id: 'node-a',
        clusterId: 'cluster-snap',
        dataDir: SNAP_TEST_DIR,
        grpcPort: 0,
        grpcHost: '127.0.0.1'
      },
      cluster: {
        membershipVersion: 1,
        members: ['node-a']
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
    const NodeService = loadedNode.quorum.node.v1.NodeService;
    nodeClient = new NodeService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });

  afterAll(async () => {
    if (nodeClient) nodeClient.close();
    await app.stop();
    if (fs.existsSync(SNAP_TEST_DIR)) {
      await fs.promises.rm(SNAP_TEST_DIR, { recursive: true, force: true });
    }
  });

  it('executes CreateSnapshot RPC over gRPC', async () => {
    // Put an item first
    await new Promise((resolve, reject) => {
      nodeClient.Put(
        {
          key: 'item:1',
          value: Buffer.from('value-before-snap'),
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

    const snapResp: any = await new Promise((resolve, reject) => {
      nodeClient.CreateSnapshot({}, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    expect(snapResp.status.code).toBe('STATUS_CODE_OK');
    expect(snapResp.snapshot_sequence).toBe('1');
    expect(snapResp.snapshot_path).toContain('.snap');
    expect(fs.existsSync(snapResp.snapshot_path)).toBe(true);
  });

  it('deduplicates identical Put retry without minting a new version dot counter (§9)', async () => {
    const put1: any = await new Promise((resolve, reject) => {
      nodeClient.Put(
        {
          key: 'idemp-key',
          value: Buffer.from('payload-A'),
          run_id: 'run-1',
          client_id: 'client-dedup',
          operation_id: 'op-dedup',
          request_id: 'req-dedup-1'
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(put1.status.message).toBe('OK');
    const dotCounter1 = put1.version.dot.counter;

    // Retry exact same request with same client_id and request_id
    const put2: any = await new Promise((resolve, reject) => {
      nodeClient.Put(
        {
          key: 'idemp-key',
          value: Buffer.from('payload-A'),
          run_id: 'run-1',
          client_id: 'client-dedup',
          operation_id: 'op-dedup',
          request_id: 'req-dedup-1'
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(put2.status.message).toBe('DEDUPLICATED');
    // Version dot counter must be identical! No duplicate version minted.
    expect(put2.version.dot.counter).toBe(dotCounter1);
  });

  it('rejects retried request with conflicting payload as STATUS_CODE_IDEMPOTENCY_CONFLICT (§9)', async () => {
    const putConflict: any = await new Promise((resolve, reject) => {
      nodeClient.Put(
        {
          key: 'idemp-key',
          value: Buffer.from('payload-DIFFERENT'), // Different payload!
          run_id: 'run-1',
          client_id: 'client-dedup',
          operation_id: 'op-dedup',
          request_id: 'req-dedup-1' // Reusing req-dedup-1
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(putConflict.status.code).toBe('STATUS_CODE_IDEMPOTENCY_CONFLICT');
    expect(putConflict.status.message).toContain('IDEMPOTENCY_CONFLICT');
  });
});
