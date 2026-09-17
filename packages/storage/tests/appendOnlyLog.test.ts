import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  AppendOnlyLog,
  WalCorruptionClass,
  StorageCorruptionError
} from '../src/index.js';

const TEST_DIR = path.resolve('./tests/tmp-log');

describe('Storage: AppendOnlyLog', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DIR)) {
      await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(TEST_DIR)) {
      await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('appends and sequentially scans valid frames', async () => {
    const log = new AppendOnlyLog({ logDir: TEST_DIR });
    await log.open();

    const data1 = Buffer.from('Record One');
    const data2 = Buffer.from('Record Two (longer payload for testing framing)');

    await log.append(data1, true);
    await log.append(data2, true);
    await log.close();

    const logReader = new AppendOnlyLog({ logDir: TEST_DIR });
    const frames = [];
    for await (const frame of logReader.scan()) {
      frames.push(Buffer.from(frame.data).toString('utf8'));
    }

    expect(frames).toEqual(['Record One', 'Record Two (longer payload for testing framing)']);
  });

  it('detects TAIL_INCOMPLETE when file is torn mid-record at EOF', async () => {
    const log = new AppendOnlyLog({ logDir: TEST_DIR });
    await log.open();
    await log.append(Buffer.from('Valid Record 1'), true);
    await log.append(Buffer.from('Valid Record 2'), true);
    await log.close();

    // Corrupt the tail by appending 3 bytes (incomplete header)
    const filePath = path.join(TEST_DIR, 'wal.seg');
    await fs.promises.appendFile(filePath, Buffer.from([0x00, 0x00, 0x05]));

    const logReader = new AppendOnlyLog({ logDir: TEST_DIR });
    const iterator = logReader.scan();

    // First two succeed
    const f1 = await iterator.next();
    expect(Buffer.from(f1.value.data).toString('utf8')).toBe('Valid Record 1');

    const f2 = await iterator.next();
    expect(Buffer.from(f2.value.data).toString('utf8')).toBe('Valid Record 2');

    // Third record throws TAIL_INCOMPLETE
    await expect(iterator.next()).rejects.toThrowError(
      expect.objectContaining({
        corruptionClass: WalCorruptionClass.TAIL_INCOMPLETE
      })
    );
  });

  it('detects TAIL_CRC_FAILURE on corrupted final record', async () => {
    const log = new AppendOnlyLog({ logDir: TEST_DIR });
    await log.open();
    await log.append(Buffer.from('Valid Record 1'), true);
    await log.append(Buffer.from('Valid Record 2'), true);
    await log.close();

    // Mutate the last byte of the file
    const filePath = path.join(TEST_DIR, 'wal.seg');
    const buf = await fs.promises.readFile(filePath);
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    await fs.promises.writeFile(filePath, buf);

    const logReader = new AppendOnlyLog({ logDir: TEST_DIR });
    const iterator = logReader.scan();

    await iterator.next(); // f1 ok

    await expect(iterator.next()).rejects.toThrowError(
      expect.objectContaining({
        corruptionClass: WalCorruptionClass.TAIL_CRC_FAILURE
      })
    );
  });

  it('detects MID_SEGMENT_CORRUPTION and does not treat it as a torn tail', async () => {
    const log = new AppendOnlyLog({ logDir: TEST_DIR });
    await log.open();
    await log.append(Buffer.from('Record 1'), true);
    await log.append(Buffer.from('Record 2'), true);
    await log.append(Buffer.from('Record 3'), true);
    await log.close();

    // Mutate the CRC of record 1 (middle of the log)
    const filePath = path.join(TEST_DIR, 'wal.seg');
    const buf = await fs.promises.readFile(filePath);
    // Record 1 size is 4 + 8 + 4 = 16 bytes. Checksum is at byte 12..15.
    buf[14] = buf[14]! ^ 0xff;
    await fs.promises.writeFile(filePath, buf);

    const logReader = new AppendOnlyLog({ logDir: TEST_DIR });
    const iterator = logReader.scan();

    await expect(iterator.next()).rejects.toThrowError(
      expect.objectContaining({
        corruptionClass: WalCorruptionClass.MID_SEGMENT_CORRUPTION
      })
    );
  });

  it('truncates log at offset cleanly', async () => {
    const log = new AppendOnlyLog({ logDir: TEST_DIR });
    await log.open();
    const { offset: off1 } = await log.append(Buffer.from('Rec 1'), true);
    const { offset: off2 } = await log.append(Buffer.from('Rec 2'), true);

    await log.truncate(off2);

    const frames = [];
    for await (const frame of log.scan()) {
      frames.push(Buffer.from(frame.data).toString('utf8'));
    }

    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe('Rec 1');
  });
});
