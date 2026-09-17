import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';

const TEST_NODE_DIR = path.resolve('./tests/tmp-node-recovery');

describe('QuorumNode Integration: Durable Crash Recovery (Q1)', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_NODE_DIR)) {
      await fs.promises.rm(TEST_NODE_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_NODE_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(TEST_NODE_DIR)) {
      await fs.promises.rm(TEST_NODE_DIR, { recursive: true, force: true });
    }
  });

  it('recovers all keys, versions, and tombstones after node process restarts', async () => {
    // 1. First run: populate node with mutations
    const app1 = new QuorumNodeApp({
      node: {
        id: 'node-a',
        clusterId: 'cluster-1',
        dataDir: TEST_NODE_DIR,
        grpcPort: 0,
        grpcHost: '127.0.0.1'
      },
      cluster: {
        membershipVersion: 1,
        members: ['node-a']
      }
    });

    await app1.start();

    // Put two items
    const put1 = await app1.engine.put({
      key: 'key-1',
      value: Buffer.from('value-one'),
      runId: 'run-1',
      clientId: 'c1',
      requestId: 'r1',
      operationId: 'op1'
    });

    const put2 = await app1.engine.put({
      key: 'key-2',
      value: Buffer.from('value-two'),
      runId: 'run-1',
      clientId: 'c1',
      requestId: 'r2',
      operationId: 'op2'
    });

    // Delete one item
    const del1 = await app1.engine.delete({
      key: 'key-1',
      runId: 'run-1',
      clientId: 'c1',
      requestId: 'r3',
      operationId: 'op3'
    });

    expect(put1.sequence).toBe(1n);
    expect(put2.sequence).toBe(2n);
    expect(del1.sequence).toBe(3n);

    // Stop app1 (simulating clean shutdown or crash after fsync)
    await app1.stop();

    // 2. Second run: start fresh node instance pointing to the same dataDir
    const app2 = new QuorumNodeApp({
      node: {
        id: 'node-a',
        clusterId: 'cluster-1',
        dataDir: TEST_NODE_DIR,
        grpcPort: 0,
        grpcHost: '127.0.0.1'
      },
      cluster: {
        membershipVersion: 1,
        members: ['node-a']
      }
    });

    await app2.start();

    // Verify state in app2 matches app1 before restart
    const get1 = app2.engine.get({ key: 'key-1' });
    expect(get1.keyState.entries).toHaveLength(1);
    expect(get1.keyState.entries[0]?.tombstone).toBe(true);

    const get2 = app2.engine.get({ key: 'key-2' });
    expect(get2.keyState.entries).toHaveLength(1);
    expect(get2.keyState.entries[0]?.tombstone).toBe(false);
    expect(Buffer.from(get2.keyState.entries[0]?.value as Uint8Array).toString()).toBe('value-two');

    // Verify sequence continued monotonically
    expect(app2.storage.getCurrentSequence()).toBe(3n);

    await app2.stop();
  });
});
