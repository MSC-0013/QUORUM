import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SnapshotManager } from '../src/index.js';
import { createVersionStamp, KeyState } from '@quorum-lab/consistency';

const TEST_SNAP_DIR = path.resolve('./tests/tmp-snap');

describe('Storage: SnapshotManager', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_SNAP_DIR)) {
      await fs.promises.rm(TEST_SNAP_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_SNAP_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(TEST_SNAP_DIR)) {
      await fs.promises.rm(TEST_SNAP_DIR, { recursive: true, force: true });
    }
  });

  it('creates atomic snapshot and verifies file rename', async () => {
    const sm = new SnapshotManager(TEST_SNAP_DIR);
    await sm.init();

    const v1 = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1 },
      lamport: 1,
      wallTimeMs: 1000
    });

    const keyStates: KeyState[] = [
      {
        key: 'k1',
        entries: [
          {
            value: new Uint8Array(Buffer.from('v1')),
            tombstone: false,
            version: v1
          }
        ]
      }
    ];

    const { snapshotPath, snapshotSequence } = await sm.createSnapshot(100n, keyStates);

    expect(snapshotSequence).toBe(100n);
    expect(fs.existsSync(snapshotPath)).toBe(true);
    // Ensure no temporary file (.tmp) left behind
    expect(fs.existsSync(`${snapshotPath}.tmp`)).toBe(false);

    const loaded = await sm.loadLatestSnapshot();
    expect(loaded).toBeDefined();
    expect(loaded?.snapshotSequence).toBe(100n);
    expect(loaded?.keyStates).toHaveLength(1);
    expect(loaded?.keyStates[0]?.key).toBe('k1');
    expect(Buffer.from(loaded?.keyStates[0]?.entries[0]?.value as Uint8Array).toString()).toBe('v1');
  });

  it('selects latest snapshot when multiple exist', async () => {
    const sm = new SnapshotManager(TEST_SNAP_DIR);
    await sm.init();

    await sm.createSnapshot(50n, []);
    await sm.createSnapshot(150n, []);
    await sm.createSnapshot(75n, []);

    const loaded = await sm.loadLatestSnapshot();
    expect(loaded?.snapshotSequence).toBe(150n);
  });
});
