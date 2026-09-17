import { VersionStamp } from '@quorum-lab/consistency';

export enum WalRecordType {
  PUT = 0,
  DELETE = 1,
  SNAPSHOT_MARKER = 2,
  IDEMPOTENCY = 3, // used starting Q1 (§9)
  HINT = 4,        // reserved for Q6
  PREPARE = 5,     // reserved for Q8
  COMMIT = 6,      // reserved for Q8
  ABORT = 7,       // reserved for Q8
  EPOCH = 8        // reserved for Q8
}

export interface WalRecordEnvelope {
  readonly recordType: WalRecordType;
  readonly sequence: bigint;
  readonly schemaVersion: number;
  readonly payload: Uint8Array;
}

export interface IdempotencyRecord {
  readonly clientId: string;
  readonly requestId: string;
  readonly operationId: string;
  readonly payloadHash: string;
  readonly status: 'APPLIED' | 'FAILED';
  readonly resultingVersion?: VersionStamp;
  readonly resultHash?: string;
}

export type LocalDurabilityMode = 'MEMORY_ONLY' | 'BATCHED_FSYNC' | 'SYNC_FSYNC';

export enum WalCorruptionClass {
  TAIL_INCOMPLETE = 'TAIL_INCOMPLETE',
  TAIL_CRC_FAILURE = 'TAIL_CRC_FAILURE',
  MID_SEGMENT_CORRUPTION = 'MID_SEGMENT_CORRUPTION'
}

export class StorageCorruptionError extends Error {
  public readonly corruptionClass: WalCorruptionClass;
  public readonly offset: number;

  constructor(message: string, corruptionClass: WalCorruptionClass, offset: number) {
    super(`[STORAGE_CORRUPTED] ${corruptionClass} at offset ${offset}: ${message}`);
    this.name = 'StorageCorruptionError';
    this.corruptionClass = corruptionClass;
    this.offset = offset;
  }
}

export class IdempotencyConflictError extends Error {
  public readonly clientId: string;
  public readonly requestId: string;

  constructor(clientId: string, requestId: string) {
    super(
      `IDEMPOTENCY_CONFLICT: Request ${requestId} for client ${clientId} already applied with a different payload`
    );
    this.name = 'IdempotencyConflictError';
    this.clientId = clientId;
    this.requestId = requestId;
  }
}
