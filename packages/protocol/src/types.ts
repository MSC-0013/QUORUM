import type {
  Dot,
  VersionStamp,
  VersionedEntry,
  KeyState,
  VersionFrontier
} from '@quorum-lab/consistency';
import type { MembershipSnapshot } from '@quorum-lab/contracts';

export type {
  Dot,
  VersionStamp,
  VersionedEntry,
  KeyState,
  VersionFrontier,
  MembershipSnapshot
};

export enum ProtoStatusCode {
  STATUS_CODE_UNSPECIFIED = 0,
  STATUS_CODE_OK = 1,
  STATUS_CODE_NOT_FOUND = 2,
  STATUS_CODE_IDEMPOTENCY_CONFLICT = 3,
  STATUS_CODE_VERSION_CONFLICT = 4,
  STATUS_CODE_STALE_MEMBERSHIP = 5,
  STATUS_CODE_UNSAFE_LEADER = 6,
  STATUS_CODE_FENCED = 7,
  STATUS_CODE_STORAGE_CORRUPTED = 8,
  STATUS_CODE_UNIMPLEMENTED = 9,
  STATUS_CODE_INTERNAL_ERROR = 10
}

export interface ProtoStatus {
  code: ProtoStatusCode;
  message: string;
  metadata?: Record<string, string>;
}

export interface PutRequest {
  key: string;
  value: Uint8Array | Buffer;
  runId: string;
  clientId: string;
  operationId: string;
  requestId: string;
  fencingEpoch?: number | bigint;
}

export interface PutResponse {
  status: ProtoStatus;
  version: VersionStamp;
  resultingFrontier: VersionFrontier;
}

export interface GetRequest {
  key: string;
  runId?: string;
  clientId?: string;
  operationId?: string;
  requestId?: string;
  readConsistency?: string;
}

export interface GetResponse {
  status: ProtoStatus;
  keyState: KeyState;
  frontier: VersionFrontier;
}

export interface DeleteRequest {
  key: string;
  runId: string;
  clientId: string;
  operationId: string;
  requestId: string;
  fencingEpoch?: number | bigint;
}

export interface DeleteResponse {
  status: ProtoStatus;
  tombstoneVersion: VersionStamp;
  resultingFrontier: VersionFrontier;
}

export interface GetVersionsRequest {
  key: string;
}

export interface GetVersionsResponse {
  maximalVersions: VersionStamp[];
}

export interface GetNodeStateRequest {
  includeKeys?: boolean;
}

export interface NodeStateResponse {
  nodeId: string;
  clusterId: string;
  lifecycleState: string;
  membership: MembershipSnapshot;
  keyCount: number;
  lamport: number;
  wallTimeMs: number;
}

export interface HealthCheckRequest {
  service: string;
}

export enum HealthCheckServingStatus {
  UNKNOWN = 0,
  SERVING = 1,
  NOT_SERVING = 2,
  SERVICE_UNKNOWN = 3
}

export interface HealthCheckResponse {
  status: HealthCheckServingStatus;
}
