import fs from 'node:fs';
import path from 'node:path';
import { KeyState } from '@quorum-lab/consistency';

export interface SnapshotData {
  readonly snapshotSequence: bigint;
  readonly createdAtMs: number;
  readonly keyStates: readonly KeyState[];
}

export class SnapshotManager {
  private readonly snapshotDir: string;

  constructor(snapshotDir: string) {
    this.snapshotDir = snapshotDir;
  }

  public async init(): Promise<void> {
    await fs.promises.mkdir(this.snapshotDir, { recursive: true });
  }

  /**
   * Creates an atomic snapshot of current key states at the specified sequence.
   * Writes to a .tmp file, issues fsync, then atomically renames to .snap.
   */
  public async createSnapshot(
    snapshotSequence: bigint,
    keyStates: readonly KeyState[]
  ): Promise<{ snapshotPath: string; snapshotSequence: bigint }> {
    await this.init();

    const fileName = `snapshot-${snapshotSequence.toString().padStart(20, '0')}.snap`;
    const finalPath = path.join(this.snapshotDir, fileName);
    const tmpPath = `${finalPath}.tmp`;

    const data: SnapshotData = {
      snapshotSequence,
      createdAtMs: Date.now(),
      keyStates
    };

    const serialized = JSON.stringify(data, (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (val instanceof Uint8Array || (val && val.type === 'Buffer')) {
        return { __b64: Buffer.from(val.data ?? val).toString('base64') };
      }
      return val;
    });

    const fileHandle = await fs.promises.open(tmpPath, 'w');
    try {
      await fileHandle.writeFile(serialized, 'utf8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    // Atomic rename
    await fs.promises.rename(tmpPath, finalPath);

    return {
      snapshotPath: finalPath,
      snapshotSequence
    };
  }

  /**
   * Discovers and loads the latest valid snapshot from disk.
   */
  public async loadLatestSnapshot(): Promise<SnapshotData | null> {
    if (!fs.existsSync(this.snapshotDir)) {
      return null;
    }

    const files = await fs.promises.readdir(this.snapshotDir);
    const snapFiles = files
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.snap'))
      .sort()
      .reverse();

    for (const snapFile of snapFiles) {
      const filePath = path.join(this.snapshotDir, snapFile);
      try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content, (_key, val) => {
          if (val && typeof val === 'object' && '__b64' in val) {
            return new Uint8Array(Buffer.from(val.__b64, 'base64'));
          }
          return val;
        });

        return {
          snapshotSequence: BigInt(parsed.snapshotSequence),
          createdAtMs: parsed.createdAtMs,
          keyStates: parsed.keyStates
        };
      } catch (err) {
        console.warn(`Corrupt or invalid snapshot file ${filePath}, falling back to older...`, err);
      }
    }

    return null;
  }
}
