import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { PROTO_DIR } from '@quorum-lab/protocol';
import { QuorumNodeApp } from '../../src/app.js';

const TEST_BASE_DIR = path.resolve('./tests/tmp-fault-service');

describe('QuorumNode: gRPC FaultControlService Integration (§Q4)', () => {
  let app: QuorumNodeApp;
  let port: number;
  let faultClient: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_BASE_DIR, { recursive: true });

    app = new QuorumNodeApp(
      {
        node: {
          id: 'faulty-node',
          clusterId: 'cluster-faults',
          dataDir: TEST_BASE_DIR,
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: {
          membershipVersion: 1,
          members: ['faulty-node', 'peer-1']
        }
      },
      { replicationMode: 'NONE' }
    );

    port = await app.start();

    // Create client for FaultControlService
    const faultPkg = protoLoader.loadSync(path.join(PROTO_DIR, 'fault.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR]
    });
    const loaded = grpc.loadPackageDefinition(faultPkg) as any;
    const FaultService = loaded.quorum.fault.v1.FaultControlService;
    faultClient = new FaultService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });

  afterAll(async () => {
    faultClient.close();
    await app.stop();
    if (fs.existsSync(TEST_BASE_DIR)) {
      await fs.promises.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('sets and clears CLOCK_SKEW fault over gRPC, updating wall clock', async () => {
    expect(app.clocks.wall.getSkewOffsetMs()).toBe(0);

    // 1. Inject clock skew (+5000ms)
    const setResp = await new Promise<any>((resolve, reject) => {
      faultClient.SetFault(
        {
          rule: {
            fault_id: 'skew-1',
            fault_type: 'FAULT_TYPE_CLOCK_SKEW',
            scope: 'FAULT_SCOPE_CLOCK',
            target_node_id: 'faulty-node',
            clock_skew_ms: 5000
          }
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(setResp.status.code).toBe('STATUS_CODE_OK');
    expect(app.clocks.wall.getSkewOffsetMs()).toBe(5000);

    // 2. Clear fault
    const clearResp = await new Promise<any>((resolve, reject) => {
      faultClient.ClearFault(
        { fault_id: 'skew-1' },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(clearResp.status.code).toBe('STATUS_CODE_OK');
    expect(app.clocks.wall.getSkewOffsetMs()).toBe(0);
  });

  it('sets PARTITION fault and clears all faults over gRPC', async () => {
    await new Promise<any>((resolve, reject) => {
      faultClient.SetFault(
        {
          rule: {
            fault_id: 'part-1',
            fault_type: 'FAULT_TYPE_PARTITION',
            scope: 'FAULT_SCOPE_NODE_TO_NODE',
            target_node_id: 'faulty-node',
            peer_node_id: 'peer-1'
          }
        },
        (err: any, resp: any) => {
          if (err) reject(err);
          else resolve(resp);
        }
      );
    });

    expect(app.faultRegistry.getActiveRules()).toHaveLength(1);
    expect(app.faultRegistry.getRule('part-1')?.type).toBe('PARTITION');

    // Clear all faults
    const clearAllResp = await new Promise<any>((resolve, reject) => {
      faultClient.ClearAllFaults({}, (err: any, resp: any) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    expect(clearAllResp.cleared_count).toBe(1);
    expect(app.faultRegistry.getActiveRules()).toHaveLength(0);
  });
});
