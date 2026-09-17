import {
  KeyState,
  VersionFrontier,
  VersionStamp
} from '@quorum-lab/consistency';
import { MemStore } from './memStore.js';
import { NodeRuntimeState } from '../runtime/nodeState.js';

export interface NodeEnginePutResult {
  version: VersionStamp;
  frontier: VersionFrontier;
}

export interface NodeEngineDeleteResult {
  tombstoneVersion: VersionStamp;
  frontier: VersionFrontier;
}

export interface NodeEngineGetResult {
  keyState: KeyState;
  frontier: VersionFrontier;
}

export class NodeEngine {
  public readonly store: MemStore;
  public readonly runtime: NodeRuntimeState;

  constructor(runtime: NodeRuntimeState, store?: MemStore) {
    this.runtime = runtime;
    this.store = store ?? new MemStore();
  }

  public put(params: {
    key: string;
    value: Uint8Array;
    runId: string;
    clientId: string;
    operationId: string;
    requestId: string;
  }): NodeEnginePutResult {
    // Generate new VersionStamp using node's clocks
    const version = this.runtime.clocks.mintVersionStamp();
    const { frontier } = this.store.put(params.key, params.value, version);

    return {
      version,
      frontier
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

  public delete(params: {
    key: string;
    runId: string;
    clientId: string;
    operationId: string;
    requestId: string;
  }): NodeEngineDeleteResult {
    const tombstoneVersion = this.runtime.clocks.mintVersionStamp();
    const { frontier } = this.store.delete(params.key, tombstoneVersion);

    return {
      tombstoneVersion,
      frontier
    };
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
  } {
    return {
      nodeId: this.runtime.nodeId,
      clusterId: this.runtime.clusterId,
      lifecycleState: this.runtime.lifecycle.getState(),
      membership: this.runtime.getMembership(),
      keyCount: this.store.size(),
      lamport: Number(this.runtime.clocks.lamport.now()),
      wallTimeMs: this.runtime.clocks.wall.nowMs()
    };
  }
}
