import {
  VersionStamp,
  VersionFrontier,
  KeyState
} from '@quorum-lab/consistency';

export interface ReplicaAckInfo {
  readonly nodeId: string;
  readonly replicaAcked: boolean;
  readonly durableAcked: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface ReplicationPutParams {
  readonly key: string;
  readonly value: Uint8Array;
  readonly runId: string;
  readonly clientId: string;
  readonly operationId: string;
  readonly requestId: string;
}

export interface ReplicationDeleteParams {
  readonly key: string;
  readonly runId: string;
  readonly clientId: string;
  readonly operationId: string;
  readonly requestId: string;
}

export interface ReplicationGetParams {
  readonly key: string;
  readonly runId?: string;
  readonly clientId?: string;
  readonly operationId?: string;
  readonly requestId?: string;
  readonly causalDependency?: Record<string, number>;
  readonly conflictStrategy?: 'LAST_WRITE_WINS' | 'MULTI_VALUE' | 'CUSTOM_MERGE' | 'VERSION_VECTOR';
}

export interface ReplicationResult {
  readonly version: VersionStamp;
  readonly frontier: VersionFrontier;
  readonly replicaAcks: readonly ReplicaAckInfo[];
  readonly totalReplicaAcks: number;
  readonly totalDurableAcks: number;
  readonly isDuplicate?: boolean;
}

export interface ReplicationGetResult {
  readonly keyState: KeyState;
  readonly frontier: VersionFrontier;
}

export interface ReplicationEngine {
  put(params: ReplicationPutParams): Promise<ReplicationResult>;
  get(params: ReplicationGetParams): Promise<ReplicationGetResult>;
  delete(params: ReplicationDeleteParams): Promise<ReplicationResult>;
  close(): Promise<void>;
}
