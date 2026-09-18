import {
  KeyState,
  VersionFrontier,
  VersionStamp,
  VersionedEntry
} from '@quorum-lab/consistency';
import {
  StorageEngine,
  WalRecordType,
  WalRecordEnvelope,
  encodeWalEnvelope,
  serializePutPayload,
  serializeDeletePayload
} from '@quorum-lab/storage';
import { ProtoStatusCode } from '@quorum-lab/protocol';
import {
  ReplicationEngine,
  SyncReplicationEngine,
  AsyncReplicationEngine,
  QuorumReplicationEngine,
  QuorumConfig,
  PeerClientPool,
  ReplicationResult
} from '@quorum-lab/replication';
import { MemStore } from './memStore.js';
import { NodeRuntimeState } from '../runtime/nodeState.js';
import { MutationExecutor } from './mutationExecutor.js';

export interface NodeEnginePutResult {
  version: VersionStamp;
  frontier: VersionFrontier;
  sequence: bigint;
  isDuplicate: boolean;
  replicationResult?: ReplicationResult;
}

export interface NodeEngineDeleteResult {
  tombstoneVersion: VersionStamp;
  frontier: VersionFrontier;
  sequence: bigint;
  isDuplicate: boolean;
  replicationResult?: ReplicationResult;
}

export interface NodeEngineGetResult {
  keyState: KeyState;
  frontier: VersionFrontier;
}

export type ReplicationMode = 'NONE' | 'SYNC' | 'ASYNC' | 'QUORUM';

export class NodeEngine {
  public readonly store: MemStore;
  public readonly runtime: NodeRuntimeState;
  public readonly storage: StorageEngine;
  public readonly mutationExecutor: MutationExecutor;
  public readonly peerPool: PeerClientPool;
  public replicationEngine: ReplicationEngine | null = null;

  constructor(
    runtime: NodeRuntimeState,
    storage?: StorageEngine,
    store?: MemStore,
    replicationMode: ReplicationMode = 'NONE',
    quorumConfig?: QuorumConfig
  ) {
    this.runtime = runtime;
    this.store = store ?? new MemStore();
    this.storage =
      storage ??
      new StorageEngine({
        dataDir: `./data/${runtime.nodeId}`,
        durabilityMode: 'SYNC_FSYNC'
      });
    this.mutationExecutor = new MutationExecutor(this.storage, this.store, this.runtime);
    this.peerPool = new PeerClientPool();

    this.initReplicationEngine(replicationMode, quorumConfig);
  }

  public initReplicationEngine(
    mode: ReplicationMode,
    quorumConfig?: QuorumConfig
  ): void {
    if (mode === 'NONE') {
      this.replicationEngine = null;
      return;
    }

    const localOps = {
      put: async (params: any) => {
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
          isDuplicate: res.isDuplicate
        };
      },
      get: (params: any) => ({
        keyState: this.store.get(params.key),
        frontier: this.store.getVersions(params.key)
      }),
      delete: async (params: any) => {
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
          isDuplicate: res.isDuplicate
        };
      },
      isDurable: () => this.storage.durabilityMode === 'SYNC_FSYNC'
    };

    if (mode === 'SYNC') {
      this.replicationEngine = new SyncReplicationEngine({
        localNodeId: this.runtime.nodeId,
        localOps,
        peerPool: this.peerPool,
        getMembership: () => this.runtime.getMembership()
      });
    } else if (mode === 'ASYNC') {
      this.replicationEngine = new AsyncReplicationEngine({
        localNodeId: this.runtime.nodeId,
        localOps,
        peerPool: this.peerPool,
        getMembership: () => this.runtime.getMembership()
      });
    } else if (mode === 'QUORUM') {
      this.replicationEngine = new QuorumReplicationEngine({
        localNodeId: this.runtime.nodeId,
        localOps,
        peerPool: this.peerPool,
        getMembership: () => this.runtime.getMembership(),
        quorumConfig: quorumConfig ?? { W: 2, R: 2 }
      });
    }
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
    if (this.replicationEngine) {
      const repRes = await this.replicationEngine.put(params);
      return {
        version: repRes.version,
        frontier: repRes.frontier,
        sequence: this.storage.getCurrentSequence(),
        isDuplicate: Boolean(repRes.isDuplicate),
        replicationResult: repRes
      };
    }

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

  public async distributedGet(params: {
    key: string;
    causalDependency?: Record<string, number>;
    conflictStrategy?: 'LAST_WRITE_WINS' | 'MULTI_VALUE' | 'CUSTOM_MERGE' | 'VERSION_VECTOR';
  }): Promise<NodeEngineGetResult> {
    if (this.replicationEngine) {
      const repRes = await this.replicationEngine.get(params);
      return {
        keyState: repRes.keyState,
        frontier: repRes.frontier
      };
    }
    return this.get(params);
  }

  public async delete(params: {
    key: string;
    runId: string;
    clientId: string;
    operationId: string;
    requestId: string;
  }): Promise<NodeEngineDeleteResult> {
    if (this.replicationEngine) {
      const repRes = await this.replicationEngine.delete(params);
      return {
        tombstoneVersion: repRes.version,
        frontier: repRes.frontier,
        sequence: this.storage.getCurrentSequence(),
        isDuplicate: Boolean(repRes.isDuplicate),
        replicationResult: repRes
      };
    }

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

  /**
   * Applies an incoming replicated mutation from a peer coordinator (§Q2).
   */
  public async applyReplicatedEntry(params: {
    key: string;
    entry: VersionedEntry;
    operationId: string;
    requestId: string;
    sourceNode: string;
    membershipHash: string;
    fencingEpoch: number;
  }): Promise<{ status: ProtoStatusCode; durableAcked: boolean; message?: string }> {
    // 1. Membership hash verification (§Q0, §Q2)
    const localHash = this.runtime.getMembership().hash;
    if (params.membershipHash !== localHash) {
      return {
        status: ProtoStatusCode.STATUS_CODE_STALE_MEMBERSHIP,
        durableAcked: false,
        message: `Stale membership: incoming hash ${params.membershipHash.slice(0, 8)} != local ${localHash.slice(0, 8)}`
      };
    }

    // 2. Witness Lamport clock
    this.runtime.clocks.lamport.witness(BigInt(params.entry.version.lamport));

    // 3. Persist to local WAL
    const recordType = params.entry.tombstone ? WalRecordType.DELETE : WalRecordType.PUT;
    const payload = params.entry.tombstone
      ? serializeDeletePayload({
          key: params.key,
          version: params.entry.version,
          clientId: `replica:${params.sourceNode}`,
          requestId: params.requestId,
          operationId: params.operationId
        })
      : serializePutPayload({
          key: params.key,
          value: params.entry.value ?? new Uint8Array(),
          tombstone: false,
          version: params.entry.version,
          clientId: `replica:${params.sourceNode}`,
          requestId: params.requestId,
          operationId: params.operationId
        });

    const envelope: WalRecordEnvelope = {
      recordType,
      sequence: this.storage.getCurrentSequence() + 1n,
      schemaVersion: 1,
      payload
    };

    const isDurable = this.storage.durabilityMode === 'SYNC_FSYNC';
    await this.storage.log.append(encodeWalEnvelope(envelope), isDurable);

    // 4. Apply to MemStore using §Q2 canonical apply rule
    this.store.applyEntry(params.key, params.entry);

    return {
      status: ProtoStatusCode.STATUS_CODE_OK,
      durableAcked: isDurable
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
    await this.peerPool.close();
    await this.storage.close();
  }
}
