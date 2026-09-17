import {
  KeyState,
  VersionFrontier,
  VersionStamp
} from '@quorum-lab/consistency';
import {
  StorageEngine,
  WalRecordType
} from '@quorum-lab/storage';
import { MemStore } from './memStore.js';
import { NodeRuntimeState } from '../runtime/nodeState.js';
import { MutationExecutor } from './mutationExecutor.js';

export interface NodeEnginePutResult {
  version: VersionStamp;
  frontier: VersionFrontier;
  sequence: bigint;
  isDuplicate: boolean;
}

export interface NodeEngineDeleteResult {
  tombstoneVersion: VersionStamp;
  frontier: VersionFrontier;
  sequence: bigint;
  isDuplicate: boolean;
}

export interface NodeEngineGetResult {
  keyState: KeyState;
  frontier: VersionFrontier;
}

export class NodeEngine {
  public readonly store: MemStore;
  public readonly runtime: NodeRuntimeState;
  public readonly storage: StorageEngine;
  public readonly mutationExecutor: MutationExecutor;

  constructor(runtime: NodeRuntimeState, storage?: StorageEngine, store?: MemStore) {
    this.runtime = runtime;
    this.store = store ?? new MemStore();
    this.storage =
      storage ??
      new StorageEngine({
        dataDir: `./data/${runtime.nodeId}`,
        durabilityMode: 'SYNC_FSYNC'
      });
    this.mutationExecutor = new MutationExecutor(this.storage, this.store, this.runtime);
  }

  public async recover(): Promise<void> {
    const report = await this.storage.recover(this.store);
    console.log(
      `[NODE ${this.runtime.nodeId}] Recovery complete: snapshot=${report.snapshotLoaded}, replayed=${report.recordsReplayed}, lastSeq=${report.lastSequence}`
    );
  }

  public async put(params: {
    key: string;
    value: Uint8Array;
    runId: string;
    clientId: string;
    operationId: string;
    requestId: string;
  }): Promise<NodeEnginePutResult> {
    const res = await this.mutationExecutor.execute({
      recordType: WalRecordType.PUT,
      key: params.key,
      value: params.value,
      clientId: params.clientId,
      requestId: params.requestId,
      operationId: params.operationId,
      runId: params.runId
    });

    return {
      version: res.version,
      frontier: res.frontier,
      sequence: res.sequence,
      isDuplicate: res.isDuplicate
    };
  }

  public get(params: { key: string }): NodeEngineGetResult {
    const keyState = this.store.get(params.key);
    const frontier = this.store.getVersions(params.key);
    return {
      keyState,
      frontier
    };
  }

  public async delete(params: {
    key: string;
    runId: string;
    clientId: string;
    operationId: string;
    requestId: string;
  }): Promise<NodeEngineDeleteResult> {
    const res = await this.mutationExecutor.execute({
      recordType: WalRecordType.DELETE,
      key: params.key,
      clientId: params.clientId,
      requestId: params.requestId,
      operationId: params.operationId,
      runId: params.runId
    });

    return {
      tombstoneVersion: res.version,
      frontier: res.frontier,
      sequence: res.sequence,
      isDuplicate: res.isDuplicate
    };
  }

  public async createSnapshot(
    destinationPath?: string
  ): Promise<{ snapshotPath: string; snapshotSequence: bigint }> {
    return this.storage.createSnapshot(this.store, destinationPath);
  }

  public getVersions(key: string): VersionFrontier {
    return this.store.getVersions(key);
  }

  public getNodeState(): {
    nodeId: string;
    clusterId: string;
    lifecycleState: string;
    membership: ReturnType<NodeRuntimeState['getMembership']>;
    keyCount: number;
    lamport: number;
    wallTimeMs: number;
    walSequence: bigint;
  } {
    return {
      nodeId: this.runtime.nodeId,
      clusterId: this.runtime.clusterId,
      lifecycleState: this.runtime.lifecycle.getState(),
      membership: this.runtime.getMembership(),
      keyCount: this.store.size(),
      lamport: Number(this.runtime.clocks.lamport.now()),
      wallTimeMs: this.runtime.clocks.wall.nowMs(),
      walSequence: this.storage.getCurrentSequence()
    };
  }

  public async close(): Promise<void> {
    await this.storage.close();
  }
}
