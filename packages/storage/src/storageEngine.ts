import path from 'node:path';
import {
  KeyState,
  VersionStamp,
  VersionFrontier
} from '@quorum-lab/consistency';
import { AppendOnlyLog } from './appendOnlyLog.js';
import { SnapshotManager } from './snapshotManager.js';
import { RecoveryManager, RecoveryReport } from './recoveryManager.js';
import { IdempotencyTable } from './idempotency.js';
import {
  WalRecordType,
  WalRecordEnvelope,
  LocalDurabilityMode,
  IdempotencyRecord
} from './types.js';
import {
  encodeWalEnvelope,
  serializePutPayload,
  serializeDeletePayload,
  serializeSnapshotMarkerPayload,
  serializeIdempotencyPayload
} from './wal.js';

// Re-export or import MemStore interface
export interface MemStoreInterface {
  get(key: string): KeyState;
  put(key: string, value: Uint8Array, version: VersionStamp): { keyState: KeyState; frontier: VersionFrontier };
  delete(key: string, version: VersionStamp): { keyState: KeyState; frontier: VersionFrontier };
  applyEntry(key: string, entry: any): KeyState;
  size(): number;
  getAllKeys(): readonly string[];
  clear(): void;
}

export interface StorageEngineOptions {
  readonly dataDir: string;
  readonly durabilityMode?: LocalDurabilityMode;
}

export class StorageEngine {
  public readonly dataDir: string;
  public readonly durabilityMode: LocalDurabilityMode;
  public readonly log: AppendOnlyLog;
  public readonly snapshotManager: SnapshotManager;
  public readonly recoveryManager: RecoveryManager;
  public readonly idempotencyTable: IdempotencyTable;
  private currentSequence = 0n;

  constructor(options: StorageEngineOptions) {
    this.dataDir = options.dataDir;
    this.durabilityMode = options.durabilityMode ?? 'SYNC_FSYNC';

    const walDir = path.join(this.dataDir, 'wal');
    const snapshotDir = path.join(this.dataDir, 'snapshots');

    this.log = new AppendOnlyLog({ logDir: walDir });
    this.snapshotManager = new SnapshotManager(snapshotDir);
    this.recoveryManager = new RecoveryManager(this.log, this.snapshotManager);
    this.idempotencyTable = new IdempotencyTable();
  }

  public async init(): Promise<void> {
    await this.log.open();
    await this.snapshotManager.init();
  }

  public getCurrentSequence(): bigint {
    return this.currentSequence;
  }

  /**
   * Recovers state from latest snapshot and WAL.
   */
  public async recover(memStore: MemStoreInterface): Promise<RecoveryReport> {
    await this.init();

    const report = await this.recoveryManager.recover({
      applySnapshot: (keyStates) => {
        memStore.clear();
        for (const ks of keyStates) {
          for (const entry of ks.entries) {
            memStore.applyEntry(ks.key, entry);
          }
        }
      },
      applyPut: (key, value, version) => {
        memStore.put(key, value, version);
      },
      applyDelete: (key, version) => {
        memStore.delete(key, version);
      },
      recordIdempotency: (record) => {
        this.idempotencyTable.record(record);
      }
    });

    this.currentSequence = report.lastSequence;
    return report;
  }

  /**
   * Atomically persists a mutation (PUT/DELETE) and its paired IdempotencyRecord
   * before issuing fsync, strictly adhering to §9 and §Q1.
   */
  public async applyMutationAtomic(
    memStore: MemStoreInterface,
    params: {
      recordType: WalRecordType.PUT | WalRecordType.DELETE;
      key: string;
      value?: Uint8Array;
      version: VersionStamp;
      clientId: string;
      requestId: string;
      operationId: string;
      payloadHash: string;
      durabilityOverride?: LocalDurabilityMode;
    }
  ): Promise<{
    keyState: KeyState;
    frontier: VersionFrontier;
    sequence: bigint;
    idempotencyRecord: IdempotencyRecord;
  }> {
    this.currentSequence += 1n;
    const seq = this.currentSequence;

    // 1. Serialize mutation payload
    let mutationPayload: Uint8Array;
    if (params.recordType === WalRecordType.PUT) {
      mutationPayload = serializePutPayload({
        key: params.key,
        value: params.value ?? new Uint8Array(),
        tombstone: false,
        version: params.version,
        clientId: params.clientId,
        requestId: params.requestId,
        operationId: params.operationId
      });
    } else {
      mutationPayload = serializeDeletePayload({
        key: params.key,
        version: params.version,
        clientId: params.clientId,
        requestId: params.requestId,
        operationId: params.operationId
      });
    }

    const mutationEnvelope: WalRecordEnvelope = {
      recordType: params.recordType,
      sequence: seq,
      schemaVersion: 1,
      payload: mutationPayload
    };

    // 2. Serialize idempotency payload
    const idempotencyRecord: IdempotencyRecord = {
      clientId: params.clientId,
      requestId: params.requestId,
      operationId: params.operationId,
      payloadHash: params.payloadHash,
      status: 'APPLIED',
      resultingVersion: params.version
    };

    const idempotencyEnvelope: WalRecordEnvelope = {
      recordType: WalRecordType.IDEMPOTENCY,
      sequence: seq,
      schemaVersion: 1,
      payload: serializeIdempotencyPayload(idempotencyRecord)
    };

    // 3. Append both envelopes atomically to WAL
    const rawMutation = encodeWalEnvelope(mutationEnvelope);
    const rawIdempotency = encodeWalEnvelope(idempotencyEnvelope);

    await this.log.append(rawMutation, false);
    await this.log.append(rawIdempotency, false);

    // 4. Fsync based on durability mode
    const effectiveDurability = params.durabilityOverride ?? this.durabilityMode;
    if (effectiveDurability === 'SYNC_FSYNC') {
      await this.log.sync();
    }

    // 5. Update MemStore
    let keyState: KeyState;
    let frontier: VersionFrontier;
    if (params.recordType === WalRecordType.PUT) {
      const result = memStore.put(params.key, params.value ?? new Uint8Array(), params.version);
      keyState = result.keyState;
      frontier = result.frontier;
    } else {
      const result = memStore.delete(params.key, params.version);
      keyState = result.keyState;
      frontier = result.frontier;
    }

    // 6. Record idempotency in memory
    this.idempotencyTable.record(idempotencyRecord);

    return {
      keyState,
      frontier,
      sequence: seq,
      idempotencyRecord
    };
  }

  /**
   * Takes an atomic snapshot of current in-memory key state and appends a SNAPSHOT_MARKER to the WAL.
   */
  public async createSnapshot(
    memStore: MemStoreInterface,
    destinationPath?: string
  ): Promise<{ snapshotPath: string; snapshotSequence: bigint }> {
    const snapshotSeq = this.currentSequence;
    const allKeys = memStore.getAllKeys();
    const keyStates: KeyState[] = allKeys.map((k) => memStore.get(k));

    const result = await this.snapshotManager.createSnapshot(snapshotSeq, keyStates);

    // Append SNAPSHOT_MARKER record to WAL
    this.currentSequence += 1n;
    const markerEnvelope: WalRecordEnvelope = {
      recordType: WalRecordType.SNAPSHOT_MARKER,
      sequence: this.currentSequence,
      schemaVersion: 1,
      payload: serializeSnapshotMarkerPayload({
        snapshotSequence: snapshotSeq,
        snapshotPath: destinationPath ?? result.snapshotPath
      })
    };

    await this.log.append(encodeWalEnvelope(markerEnvelope), this.durabilityMode === 'SYNC_FSYNC');

    return result;
  }

  public async close(): Promise<void> {
    await this.log.close();
  }
}
