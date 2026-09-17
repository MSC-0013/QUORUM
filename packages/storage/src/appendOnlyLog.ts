import fs from 'node:fs';
import path from 'node:path';
import { crc32c } from './crc32c.js';
import {
  WalCorruptionClass,
  StorageCorruptionError
} from './types.js';

export interface LogFrame {
  readonly offset: number;
  readonly data: Uint8Array;
  readonly length: number;
}

export interface AppendOnlyLogOptions {
  readonly logDir: string;
  readonly segmentName?: string;
  readonly maxSegmentBytes?: number;
}

export class AppendOnlyLog {
  private readonly logDir: string;
  private readonly segmentName: string;
  private filePath: string;
  private fileHandle: fs.promises.FileHandle | null = null;
  private currentOffset = 0;

  constructor(options: AppendOnlyLogOptions) {
    this.logDir = options.logDir;
    this.segmentName = options.segmentName ?? 'wal.seg';
    this.filePath = path.join(this.logDir, this.segmentName);
  }

  public async open(): Promise<void> {
    await fs.promises.mkdir(this.logDir, { recursive: true });
    this.fileHandle = await fs.promises.open(this.filePath, 'a+');
    const stats = await this.fileHandle.stat();
    this.currentOffset = stats.size;
  }

  public getOffset(): number {
    return this.currentOffset;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  /**
   * Appends a record formatted as [u32 length][data bytes][u32 crc32c].
   * If sync is true, immediately issues an fsync.
   */
  public async append(data: Uint8Array, sync = false): Promise<{ offset: number; bytesWritten: number }> {
    if (!this.fileHandle) {
      await this.open();
    }

    const length = data.length;
    const checksum = crc32c(data);

    // 4 bytes length + length bytes data + 4 bytes CRC
    const frame = Buffer.allocUnsafe(4 + length + 4);
    frame.writeUInt32BE(length, 0);
    frame.set(data, 4);
    frame.writeUInt32BE(checksum, 4 + length);

    const writeOffset = this.currentOffset;
    const { bytesWritten } = await this.fileHandle!.write(frame, 0, frame.length, writeOffset);
    this.currentOffset += bytesWritten;

    if (sync) {
      await this.fileHandle!.sync();
    }

    return { offset: writeOffset, bytesWritten };
  }

  public async sync(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.sync();
    }
  }

  /**
   * Truncates the log file to the specified offset.
   */
  public async truncate(offset: number): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
    await fs.promises.truncate(this.filePath, offset);
    this.currentOffset = offset;
    await this.open();
  }

  /**
   * Sequentially scans and validates all frames in the log segment.
   * Classifies any incomplete or corrupted frames per §Q1 rules.
   */
  public async *scan(): AsyncIterable<LogFrame> {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    const buffer = await fs.promises.readFile(this.filePath);
    const totalSize = buffer.length;
    let offset = 0;

    while (offset < totalSize) {
      const remainingBytes = totalSize - offset;

      // Check if we can read the 4-byte length header
      if (remainingBytes < 4) {
        // Less than 4 bytes remaining at the end of the file
        throw new StorageCorruptionError(
          `Incomplete header: ${remainingBytes} bytes remaining, expected 4`,
          WalCorruptionClass.TAIL_INCOMPLETE,
          offset
        );
      }

      const declaredLength = buffer.readUInt32BE(offset);
      const totalFrameSize = 4 + declaredLength + 4;

      if (remainingBytes < totalFrameSize) {
        // Not enough bytes for full record + CRC
        throw new StorageCorruptionError(
          `Declared length ${declaredLength} exceeds remaining file bytes ${remainingBytes - 4}`,
          WalCorruptionClass.TAIL_INCOMPLETE,
          offset
        );
      }

      const dataSlice = buffer.subarray(offset + 4, offset + 4 + declaredLength);
      const readChecksum = buffer.readUInt32BE(offset + 4 + declaredLength);
      const computedChecksum = crc32c(dataSlice);

      if (computedChecksum !== readChecksum) {
        // CRC failure
        const isAtTail = offset + totalFrameSize >= totalSize;
        const corruptionClass = isAtTail
          ? WalCorruptionClass.TAIL_CRC_FAILURE
          : WalCorruptionClass.MID_SEGMENT_CORRUPTION;

        throw new StorageCorruptionError(
          `CRC mismatch: computed ${computedChecksum.toString(16)}, stored ${readChecksum.toString(16)}`,
          corruptionClass,
          offset
        );
      }

      yield {
        offset,
        length: declaredLength,
        data: dataSlice
      };

      offset += totalFrameSize;
    }
  }

  public async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }
}
