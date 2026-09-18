import { ClusterPolicyConfig, MembershipSnapshot } from '@quorum-lab/contracts';

export type ExperimentRunStatus =
  | 'QUEUED'
  | 'EXECUTION_REQUESTED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED'
  | 'CANCELLED';

export interface ExperimentFaultEvent {
  readonly offsetMs: number;
  readonly type: string;
  readonly targetNodeId: string;
  readonly parameters?: Record<string, any>;
}

export interface ExperimentWorkloadConfig {
  readonly keyCount: number;
  readonly operationsTotal: number;
  readonly readRatio: number;
  readonly writeRatio: number;
  readonly distribution?: 'UNIFORM' | 'ZIPFIAN';
}

export interface ExperimentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly clusterId: string;
  readonly name: string;
  readonly description?: string;
  readonly workload: ExperimentWorkloadConfig;
  readonly faultTimeline: readonly ExperimentFaultEvent[];
  readonly createdAt: string;
}

export interface ExperimentRunRecord {
  readonly id: string;
  readonly experimentId: string;
  readonly clusterId: string;
  readonly status: ExperimentRunStatus;
  readonly rootSeed: string;
  readonly clusterPolicySnapshot: ClusterPolicyConfig;
  readonly membershipSnapshot: MembershipSnapshot;
  readonly executionId?: string;
  readonly idempotencyKey?: string;
  readonly artifact?: {
    readonly uri: string;
    readonly sha256: string;
    readonly mediaType: string;
  };
  readonly cancelReason?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly result?: {
    readonly totalOperations: number;
    readonly successfulOperations: number;
    readonly failedOperations: number;
    readonly divergenceDetected: boolean;
    readonly anomaliesFound: readonly string[];
    readonly traceLogUri?: string;
  };
  readonly createdAt: string;
}

export class ExperimentRepository {
  private readonly experiments = new Map<string, ExperimentRecord>();
  private readonly runs = new Map<string, ExperimentRunRecord>();

  public createExperiment(params: {
    id?: string;
    projectId: string;
    clusterId: string;
    name: string;
    description?: string;
    workload: ExperimentWorkloadConfig;
    faultTimeline?: readonly ExperimentFaultEvent[];
  }): ExperimentRecord {
    const id = params.id ?? `exp-${Math.random().toString(36).substring(2, 9)}`;
    if (this.experiments.has(id)) {
      throw new Error(`Experiment with ID ${id} already exists`);
    }

    const record: ExperimentRecord = {
      id,
      projectId: params.projectId,
      clusterId: params.clusterId,
      name: params.name,
      description: params.description,
      workload: params.workload,
      faultTimeline: params.faultTimeline ?? [],
      createdAt: new Date().toISOString()
    };

    this.experiments.set(id, Object.freeze(record));
    return record;
  }

  public getExperiment(id: string): ExperimentRecord | undefined {
    return this.experiments.get(id);
  }

  public listExperiments(clusterId?: string): readonly ExperimentRecord[] {
    const all = Array.from(this.experiments.values());
    if (clusterId) {
      return all.filter((e) => e.clusterId === clusterId);
    }
    return all;
  }

  public createRun(params: {
    id?: string;
    experimentId: string;
    clusterId: string;
    rootSeed?: string;
    clusterPolicySnapshot: ClusterPolicyConfig;
    membershipSnapshot: MembershipSnapshot;
  }): ExperimentRunRecord {
    const id = params.id ?? `run-${Math.random().toString(36).substring(2, 9)}`;
    if (this.runs.has(id)) {
      throw new Error(`Experiment run with ID ${id} already exists`);
    }

    const record: ExperimentRunRecord = {
      id,
      experimentId: params.experimentId,
      clusterId: params.clusterId,
      status: 'QUEUED',
      rootSeed: params.rootSeed ?? `seed-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      clusterPolicySnapshot: Object.freeze(JSON.parse(JSON.stringify(params.clusterPolicySnapshot))),
      membershipSnapshot: params.membershipSnapshot,
      createdAt: new Date().toISOString()
    };

    this.runs.set(id, Object.freeze(record));
    return record;
  }

  public updateRunStatus(
    runId: string,
    status: ExperimentRunStatus,
    extra?: {
      startedAt?: string;
      completedAt?: string;
      result?: ExperimentRunRecord['result'];
    }
  ): ExperimentRunRecord {
    const existing = this.runs.get(runId);
    if (!existing) {
      throw new Error(`Experiment run ${runId} not found`);
    }

    const updated: ExperimentRunRecord = {
      ...existing,
      status,
      startedAt: extra?.startedAt ?? existing.startedAt,
      completedAt: extra?.completedAt ?? existing.completedAt,
      result: extra?.result ?? existing.result
    };

    this.runs.set(runId, Object.freeze(updated));
    return updated;
  }

  public requestRunExecution(
    runId: string,
    params: {
      executionId: string;
      idempotencyKey?: string;
      artifact?: {
        readonly uri: string;
        readonly sha256: string;
        readonly mediaType: string;
      };
      seed?: number;
      options?: {
        durationMs?: number;
        concurrency?: number;
      };
    }
  ): ExperimentRunRecord {
    const existing = this.runs.get(runId);
    if (!existing) {
      throw new Error(`Experiment run ${runId} not found`);
    }

    const key = params.idempotencyKey ?? params.executionId;

    // Idempotency: if already requested or running with matching execution key, return existing
    if (existing.status === 'EXECUTION_REQUESTED' || existing.status === 'RUNNING') {
      if (existing.executionId === params.executionId || existing.idempotencyKey === key) {
        return existing;
      }
      throw new Error(`Conflict: Run ${runId} is already active under execution ${existing.executionId}`);
    }

    if (existing.status !== 'QUEUED') {
      throw new Error(`Cannot execute run ${runId} in status ${existing.status}`);
    }

    const updated: ExperimentRunRecord = {
      ...existing,
      status: 'EXECUTION_REQUESTED',
      executionId: params.executionId,
      idempotencyKey: key,
      artifact: params.artifact ? Object.freeze({ ...params.artifact }) : undefined
    };

    this.runs.set(runId, Object.freeze(updated));
    return updated;
  }

  public cancelRun(runId: string, reason?: string): ExperimentRunRecord {
    const existing = this.runs.get(runId);
    if (!existing) {
      throw new Error(`Experiment run ${runId} not found`);
    }

    if (['COMPLETED', 'FAILED', 'ABORTED', 'CANCELLED'].includes(existing.status)) {
      throw new Error(`Cannot cancel run ${runId} in terminal status ${existing.status}`);
    }

    const updated: ExperimentRunRecord = {
      ...existing,
      status: 'CANCELLED',
      cancelReason: reason ?? 'Cancelled by client request',
      completedAt: new Date().toISOString()
    };

    this.runs.set(runId, Object.freeze(updated));
    return updated;
  }

  public getRun(id: string): ExperimentRunRecord | undefined {
    return this.runs.get(id);
  }

  public listRuns(experimentId?: string): readonly ExperimentRunRecord[] {
    const all = Array.from(this.runs.values());
    if (experimentId) {
      return all.filter((r) => r.experimentId === experimentId);
    }
    return all;
  }

  public clear(): void {
    this.experiments.clear();
    this.runs.clear();
  }
}
