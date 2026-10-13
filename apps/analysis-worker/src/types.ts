export type OperationType = 'PUT' | 'GET' | 'DELETE';

export interface RecordedOperation {
  readonly operationId: string;
  readonly clientId: string;
  readonly type: OperationType;
  readonly key: string;
  readonly value?: string | Uint8Array | null;
  readonly versionCounter?: number;
  readonly vectorClock?: Record<string, number>;
  readonly startOffsetMs: number;
  readonly finishOffsetMs: number;
  readonly targetNode: string;
  readonly success: boolean;
  readonly error?: string;
}

export type ConsistencyVerdict = 'PASS' | 'VIOLATION' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';

export interface ViolationRecord {
  readonly violationType: 'STALE_READ' | 'READ_YOUR_WRITES' | 'MONOTONIC_READS' | 'CAUSAL_DEPENDENCY' | 'LOST_UPDATE';
  readonly operationId: string;
  readonly clientId: string;
  readonly key: string;
  readonly expectedVersion?: string;
  readonly observedVersion?: string;
  readonly detail: string;
}

export interface AnalysisSummary {
  readonly totalOperations: number;
  readonly reads: number;
  readonly writes: number;
  readonly successRate: number;
  readonly verdicts: {
    readonly staleReads: ConsistencyVerdict;
    readonly readYourWrites: ConsistencyVerdict;
    readonly monotonicReads: ConsistencyVerdict;
    readonly causalConsistency: ConsistencyVerdict;
  };
  readonly violations: readonly ViolationRecord[];
  readonly detectedConflicts: number;
}
