import { WorkloadConfig, WorkloadGenerator, WorkloadSummary } from './workloadGenerator.js';
import { TimelineRunner } from './timelineRunner.js';
import { TimelineEvent } from '@quorum-lab/fault-model';
import { createNodeClient, createFaultClient } from './grpcClients.js';

export interface ExperimentRunSpec {
  readonly runId: string;
  readonly rootSeed: string;
  readonly coordinatorAddress: string;
  readonly nodeAddresses: Record<string, string>; // nodeId -> address
  readonly workload: WorkloadConfig;
  readonly faultTimeline: readonly TimelineEvent[];
}

export interface ExperimentExecutionReport {
  readonly runId: string;
  readonly rootSeed: string;
  readonly summary: WorkloadSummary;
  readonly durationMs: number;
}

export class ExperimentOrchestrator {
  public async execute(spec: ExperimentRunSpec): Promise<ExperimentExecutionReport> {
    const coordinatorNodeClient = createNodeClient(spec.coordinatorAddress);

    const faultClients: Record<string, any> = {};
    for (const [nodeId, address] of Object.entries(spec.nodeAddresses)) {
      faultClients[nodeId] = createFaultClient(address);
    }

    const timelineRunner = new TimelineRunner(spec.faultTimeline, faultClients);
    const workloadGenerator = new WorkloadGenerator({
      config: spec.workload,
      rootSeed: spec.rootSeed,
      nodeClient: coordinatorNodeClient,
      runId: spec.runId
    });

    const startTime = Date.now();
    let summary: WorkloadSummary;

    try {
      // Run fault timeline and workload concurrently
      const [, workloadResult] = await Promise.all([
        timelineRunner.run(),
        workloadGenerator.run()
      ]);
      summary = workloadResult;
    } finally {
      // Invariant: always clear all injected faults after run
      await timelineRunner.cleanup();

      // Close clients
      coordinatorNodeClient.close?.();
      for (const fc of Object.values(faultClients)) {
        fc.close?.();
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      runId: spec.runId,
      rootSeed: spec.rootSeed,
      summary,
      durationMs
    };
  }
}
