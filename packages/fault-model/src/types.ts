export type FaultType =
  | 'DELAY'
  | 'LOSS'
  | 'DUPLICATION'
  | 'REORDER'
  | 'PARTITION'
  | 'CLOCK_SKEW'
  | 'SLOW_DISK'
  | 'WRITE_FAILURE'
  | 'READ_FAILURE';

export type FaultScope =
  | 'NODE_TO_NODE'
  | 'CLIENT_TO_NODE'
  | 'PROCESS'
  | 'STORAGE'
  | 'CLOCK';

export interface FaultRule {
  readonly faultId: string;
  readonly type: FaultType;
  readonly scope: FaultScope;
  readonly targetNodeId?: string;
  readonly peerNodeId?: string;
  readonly delayMs?: number;
  readonly probability?: number;
  readonly clockSkewMs?: number;
  readonly durationMs?: number;
  readonly createdAt?: string;
}

export interface FaultEvaluationContext {
  readonly scope: FaultScope;
  readonly localNodeId: string;
  readonly peerNodeId?: string;
  readonly operationType?: string;
}

export interface FaultDecision {
  readonly allow: boolean;
  readonly delayMs?: number;
  readonly drop?: boolean;
  readonly injectError?: string;
}
