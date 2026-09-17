import {
  VersionStamp,
  VersionFrontier
} from '@quorum-lab/consistency';
import {
  StorageEngine,
  WalRecordType,
  IdempotencyTable
} from '@quorum-lab/storage';
import { MemStore } from './memStore.js';
import { NodeRuntimeState } from '../runtime/nodeState.js';

export interface MutationExecuteParams {
  recordType: WalRecordType.PUT | WalRecordType.DELETE;
  key: string;
  value?: Uint8Array;
  clientId: string;
  requestId: string;
  operationId: string;
  runId: string;
}

export interface MutationExecuteResult {
  version: VersionStamp;
  frontier: VersionFrontier;
  sequence: bigint;
  isDuplicate: boolean;
}

export class MutationExecutor {
  private readonly storage: StorageEngine;
  private readonly store: MemStore;
  private readonly runtime: NodeRuntimeState;
  private queueTail: Promise<any> = Promise.resolve();

  constructor(storage: StorageEngine, store: MemStore, runtime: NodeRuntimeState) {
    this.storage = storage;
    this.store = store;
    this.runtime = runtime;
  }

  /**
   * Enqueues a write mutation to be executed sequentially.
   */
  public async execute(params: MutationExecuteParams): Promise<MutationExecuteResult> {
    // Chain onto queue to guarantee strict sequential execution
    const execution = this.queueTail.then(() => this.processMutation(params));
    this.queueTail = execution.catch(() => {}); // Prevent unhandled rejection breaking queue
    return execution;
  }

  private async processMutation(params: MutationExecuteParams): Promise<MutationExecuteResult> {
    const payloadForHash = {
      recordType: params.recordType,
      key: params.key,
      value: params.value ? Buffer.from(params.value).toString('base64') : null,
      operationId: params.operationId
    };

    const payloadHash = IdempotencyTable.hashPayload(payloadForHash);

    // 1. Check idempotency table (§9)
    const existing = this.storage.idempotencyTable.check(
      params.clientId,
      params.requestId,
      payloadHash
    );

    if (existing && existing.resultingVersion) {
      // Deduplicated retry: return original version and current frontier
      const currentFrontier = this.store.getVersions(params.key);
      return {
        version: existing.resultingVersion,
        frontier: currentFrontier,
        sequence: this.storage.getCurrentSequence(),
        isDuplicate: true
      };
    }

    // 2. Mint new VersionStamp using node's clocks
    const version = this.runtime.clocks.mintVersionStamp();

    // 3. Atomically persist mutation + IdempotencyRecord to WAL with fsync
    const result = await this.storage.applyMutationAtomic(this.store, {
      recordType: params.recordType,
      key: params.key,
      value: params.value,
      version,
      clientId: params.clientId,
      requestId: params.requestId,
      operationId: params.operationId,
      payloadHash
    });

    return {
      version: result.idempotencyRecord.resultingVersion ?? version,
      frontier: result.frontier,
      sequence: result.sequence,
      isDuplicate: false
    };
  }
}
