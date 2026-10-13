export interface AnalysisSummary {
  readonly totalOperations: number;
  readonly reads: number;
  readonly writes: number;
  readonly successRate: number;
  readonly verdicts: {
    readonly staleReads: 'PASS' | 'VIOLATION' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';
    readonly readYourWrites: 'PASS' | 'VIOLATION' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';
    readonly monotonicReads: 'PASS' | 'VIOLATION' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';
    readonly causalConsistency: 'PASS' | 'VIOLATION' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';
  };
  readonly violations: readonly any[];
  readonly detectedConflicts: number;
}

export interface PerformanceMetrics {
  readonly throughputRps: number;
  readonly p50LatencyMs: number;
  readonly p90LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly maxLatencyMs: number;
  readonly meanLatencyMs: number;
}

export interface QuorumExperimentReport {
  readonly runId: string;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly metrics: PerformanceMetrics;
  readonly analysis: AnalysisSummary;
  readonly sloStatus: {
    readonly availability: 'PASS' | 'FAIL';
    readonly p99Latency: 'PASS' | 'FAIL';
    readonly errorRate: 'PASS' | 'FAIL';
  };
}
