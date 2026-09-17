import { KeyState } from '@quorum-lab/consistency';
import { AppendOnlyLog } from './appendOnlyLog.js';
import { SnapshotManager, SnapshotData } from './snapshotManager.js';
import {
  decodeWalEnvelope,
  deserializePutPayload,
  deserializeDeletePayload,
  deserializeIdempotencyPayload
} from './wal.js';
import {
  WalRecordType,
  WalRecordEnvelope,
  WalCorruptionClass,
  StorageCorruptionError,
  IdempotencyRecord
} from './types.js';

export interface RecoveryTarget {
  applySnapshot(keyStates: readonly KeyState[]): void;
  applyPut(key: string, value: Uint8Array, version: any): void;
  applyDelete(key: string, version: any): void;
  recordIdempotency(record: IdempotencyRecord): void;
}

export interface RecoveryReport {
  snapshotLoaded: boolean;
  snapshotSequence: bigint;
  recordsReplayed: number;
  lastSequence: bigint;
  truncatedTailBytes: number;
}

export class RecoveryManager {
  private readonly log: AppendOnlyLog;
  private readonly snapshotManager: SnapshotManager;

  constructor(log: AppendOnlyLog, snapshotManager: SnapshotManager) {
    this.log = log;
    this.snapshotManager = snapshotManager;
  }

  public async recover(target: RecoveryTarget): Promise<RecoveryReport> {
    let snapshotLoaded = false;
    let snapshotSequence = 0n;
    let lastSequence = 0n;
    let recordsReplayed = 0;
    let truncatedTailBytes = 0;

    // 1. Load latest valid snapshot
    const snapshot: SnapshotData | null = await this.snapshotManager.loadLatestSnapshot();
    if (snapshot) {
      snapshotLoaded = true;
      snapshotSequence = snapshot.snapshotSequence;
      lastSequence = snapshotSequence;
      target.applySnapshot(snapshot.keyStates);
    }

    // 2. Scan WAL
    const envelopesToReplay: WalRecordEnvelope[] = [];

    try {
      for await (const frame of this.log.scan()) {
        const envelope = decodeWalEnvelope(frame.data);
        if (envelope.sequence > snapshotSequence) {
          envelopesToReplay.push(envelope);
        }
        if (envelope.sequence > lastSequence) {
          lastSequence = envelope.sequence;
        }
      }
    } catch (err) {
      if (err instanceof StorageCorruptionError) {
        if (
          err.corruptionClass === WalCorruptionClass.TAIL_INCOMPLETE ||
          err.corruptionClass === WalCorruptionClass.TAIL_CRC_FAILURE
        ) {
          // Truncate torn tail cleanly at error.offset
          const preTruncateOffset = this.log.getOffset();
          await this.log.truncate(err.offset);
          truncatedTailBytes = preTruncateOffset - err.offset;
          console.warn(
            `[RECOVERY] Cleaned up torn tail (${truncatedTailBytes} bytes) at offset ${err.offset}`
          );
        } else {
          // MID_SEGMENT_CORRUPTION: Must never silently ignore or truncate past
          throw err;
        }
      } else {
        throw err;
      }
    }

    // 3. Replay valid records in sequence order
    for (const envelope of envelopesToReplay) {
      switch (envelope.recordType) {
        case WalRecordType.PUT: {
          const put = deserializePutPayload(envelope.payload);
          target.applyPut(put.key, put.value, put.version);
          recordsReplayed++;
          break;
        }
        case WalRecordType.DELETE: {
          const del = deserializeDeletePayload(envelope.payload);
          target.applyDelete(del.key, del.version);
          recordsReplayed++;
          break;
        }
        case WalRecordType.IDEMPOTENCY: {
          const idemp = deserializeIdempotencyPayload(envelope.payload);
          target.recordIdempotency(idemp);
          break;
        }
        case WalRecordType.SNAPSHOT_MARKER:
          // Informational marker in WAL
          break;
        default:
          // Unused reserved record types
          break;
      }
    }

    return {
      snapshotLoaded,
      snapshotSequence,
      recordsReplayed,
      lastSequence,
      truncatedTailBytes
    };
  }
}
