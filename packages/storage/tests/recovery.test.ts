import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  AppendOnlyLog,
  SnapshotManager,
  RecoveryManager,
  StorageEngine,
  encodeWalEnvelope,
  serializePutPayload,
  WalRecordType,
  WalRecordEnvelope,
  StorageCorruptionError
} from '../src/index.js';
import { createVersionStamp, KeyState } from '@quorum-lab/consistency';

const TEST_DATA_DIR = path.resolve('./tests/tmp-recovery-data');

class MockMemStore {
  public store = new Map<string, KeyState>();
  public applyCalls: string[] = [];

  get(key: string): KeyState {
    return this.store.get(key) ?? { key, entries: [] };
  }
  put(key: string, value: Uint8Array, version: any) {
    const entry = { value, tombstone: false, version };
    const ks = { key, entries: [entry] };
    this.store.set(key, ks);
    this.applyCalls.push(`put:${key}`);
    return { keyState: ks, frontier: { maximalVersions: [version] } };
  }
  delete(key: string, version: any) {
    const entry = { value: null, tombstone: true, version };
    const ks = { key, entries: [entry] };
    this.store.set(key, ks);
    this.applyCalls.push(`del:${key}`);
    return { keyState: ks, frontier: { maximalVersions: [version] } };
  }
  applyEntry(key: string, entry: any) {
    const ks = { key, entries: [entry] };
    this.store.set(key, ks);
    return ks;
  }
  size() { return this.store.size; }
  getAllKeys() { return Array.from(this.store.keys()); }
  clear() { this.store.clear(); this.applyCalls = []; }
}

describe('Storage: RecoveryManager & StorageEngine Crash Recovery', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      await fs.promises.rm(TEST_DATA_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      await fs.promises.rm(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  it('recovers accurately from WAL without snapshot', async () => {
    const engine = new StorageEngine({ dataDir: TEST_DATA_DIR, durabilityMode: 'SYNC_FSYNC' });
    const memStore = new MockMemStore();

    await engine.init();

    const v1 = createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: { 'node-a': 1 }, lamport: 1, wallTimeMs: 1000 });
    const v2 = createVersionStamp({ nodeId: 'node-a', counter: 2, vectorClock: { 'node-a': 2 }, lamport: 2, wallTimeMs: 1005 });

    await engine.applyMutationAtomic(memStore, {
      recordType: WalRecordType.PUT,
      key: 'key-1',
      value: Buffer.from('val-1'),
      version: v1,
      clientId: 'c1',
      requestId: 'r1',
      operationId: 'op1',
      payloadHash: 'hash1'
    });

    await engine.applyMutationAtomic(memStore, {
      recordType: WalRecordType.PUT,
      key: 'key-2',
      value: Buffer.from('val-2'),
      version: v2,
      clientId: 'c1',
      requestId: 'r2',
      operationId: 'op2',
      payloadHash: 'hash2'
    });

    await engine.close();

    // Now simulate restart with fresh instance
    const restartedEngine = new StorageEngine({ dataDir: TEST_DATA_DIR });
    const freshMemStore = new MockMemStore();

    const report = await restartedEngine.recover(freshMemStore);

    expect(report.snapshotLoaded).toBe(false);
    expect(report.recordsReplayed).toBe(2);
    expect(freshMemStore.store.size).toBe(2);
    expect(Buffer.from(freshMemStore.store.get('key-1')?.entries[0]?.value as Uint8Array).toString()).toBe('val-1');
    expect(Buffer.from(freshMemStore.store.get('key-2')?.entries[0]?.value as Uint8Array).toString()).toBe('val-2');

    // Verify idempotency table was also restored
    expect(restartedEngine.idempotencyTable.get('c1', 'r1')).toBeDefined();
    expect(restartedEngine.idempotencyTable.get('c1', 'r2')).toBeDefined();

    await restartedEngine.close();
  });

  it('recovers accurately from snapshot + WAL tail (snapshotSeq S + WAL after S)', async () => {
    const engine = new StorageEngine({ dataDir: TEST_DATA_DIR });
    const memStore = new MockMemStore();
    await engine.init();

    const v1 = createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: { 'node-a': 1 }, lamport: 1, wallTimeMs: 1000 });
    await engine.applyMutationAtomic(memStore, {
      recordType: WalRecordType.PUT,
      key: 'snap-key',
      value: Buffer.from('snap-val'),
      version: v1,
      clientId: 'c1',
      requestId: 'r1',
      operationId: 'op1',
      payloadHash: 'hash1'
    });

    // Take snapshot at seq 1
    const snapResult = await engine.createSnapshot(memStore);
    expect(snapResult.snapshotSequence).toBe(1n);

    // Apply more mutations after snapshot
    const v2 = createVersionStamp({ nodeId: 'node-a', counter: 2, vectorClock: { 'node-a': 2 }, lamport: 2, wallTimeMs: 1020 });
    await engine.applyMutationAtomic(memStore, {
      recordType: WalRecordType.PUT,
      key: 'post-snap-key',
      value: Buffer.from('post-snap-val'),
      version: v2,
      clientId: 'c1',
      requestId: 'r2',
      operationId: 'op2',
      payloadHash: 'hash2'
    });

    await engine.close();

    // Restart fresh
    const recoveredEngine = new StorageEngine({ dataDir: TEST_DATA_DIR });
    const recoveredMemStore = new MockMemStore();

    const report = await recoveredEngine.recover(recoveredMemStore);

    expect(report.snapshotLoaded).toBe(true);
    expect(report.snapshotSequence).toBe(1n);
    expect(report.recordsReplayed).toBe(1); // Only the record after snapshot
    expect(recoveredMemStore.store.size).toBe(2);
    expect(Buffer.from(recoveredMemStore.store.get('snap-key')?.entries[0]?.value as Uint8Array).toString()).toBe('snap-val');
    expect(Buffer.from(recoveredMemStore.store.get('post-snap-key')?.entries[0]?.value as Uint8Array).toString()).toBe('post-snap-val');

    await recoveredEngine.close();
  });

  it('cleanly truncates torn write at tail and completes recovery', async () => {
    const engine = new StorageEngine({ dataDir: TEST_DATA_DIR });
    const memStore = new MockMemStore();
    await engine.init();

    const v1 = createVersionStamp({ nodeId: 'node-a', counter: 1, vectorClock: { 'node-a': 1 }, lamport: 1, wallTimeMs: 1000 });
    await engine.applyMutationAtomic(memStore, {
      recordType: WalRecordType.PUT,
      key: 'valid-key',
      value: Buffer.from('valid-val'),
      version: v1,
      clientId: 'c1',
      requestId: 'r1',
      operationId: 'op1',
      payloadHash: 'hash1'
    });

    await engine.close();

    // Append 5 garbage bytes to WAL simulating crash mid-write
    const walFile = path.join(TEST_DATA_DIR, 'wal', 'wal.seg');
    await fs.promises.appendFile(walFile, Buffer.from([0x00, 0x00, 0x10, 0xAA, 0xBB]));

    const recoveredEngine = new StorageEngine({ dataDir: TEST_DATA_DIR });
    const recoveredMemStore = new MockMemStore();

    const report = await recoveredEngine.recover(recoveredMemStore);

    expect(report.truncatedTailBytes).toBeGreaterThan(0);
    expect(recoveredMemStore.store.size).toBe(1);
    expect(Buffer.from(recoveredMemStore.store.get('valid-key')?.entries[0]?.value as Uint8Array).toString()).toBe('valid-val');

    await recoveredEngine.close();
  });
});
