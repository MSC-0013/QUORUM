import { DeterministicRng, deriveStreamSeed } from '@quorum-lab/fault-model';
import { SystemMonotonicClock } from '@quorum-lab/clocks';

export interface WorkloadConfig {
  readonly keyCount: number;
  readonly operationsTotal: number;
  readonly readRatio: number;
  readonly writeRatio: number;
  readonly distribution?: 'UNIFORM' | 'ZIPFIAN';
}

export interface OperationTrace {
  readonly opIndex: number;
  readonly type: 'PUT' | 'GET';
  readonly key: string;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly version?: any;
  readonly error?: string;
  readonly startMonotonicNs: bigint;
  readonly endMonotonicNs: bigint;
}

export interface WorkloadSummary {
  readonly totalOperations: number;
  readonly successfulOperations: number;
  readonly failedOperations: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly traces: readonly OperationTrace[];
}

export class WorkloadGenerator {
  private readonly config: WorkloadConfig;
  private readonly rng: DeterministicRng;
  private readonly clock: SystemMonotonicClock;
  private readonly nodeClient: any;
  private readonly runId: string;
  private readonly clientId: string;

  constructor(params: {
    config: WorkloadConfig;
    rootSeed: string;
    nodeClient: any;
    runId: string;
    clientId?: string;
  }) {
    this.config = params.config;
    const seed = deriveStreamSeed(params.rootSeed, 'workload', params.runId);
    this.rng = new DeterministicRng(seed);
    this.clock = new SystemMonotonicClock();
    this.nodeClient = params.nodeClient;
    this.runId = params.runId;
    this.clientId = params.clientId ?? 'worker-client-1';
  }

  private pickKey(): string {
    const keyIdx =
      this.config.distribution === 'ZIPFIAN'
        ? this.rng.sampleZipfian(this.config.keyCount, 1.0) - 1
        : this.rng.nextInt(0, this.config.keyCount - 1);
    return `key-${keyIdx}`;
  }

  public async run(): Promise<WorkloadSummary> {
    const traces: OperationTrace[] = [];
    const latencies: number[] = [];

    for (let opIdx = 0; opIdx < this.config.operationsTotal; opIdx++) {
      const isRead = this.rng.nextFloat() < this.config.readRatio;
      const key = this.pickKey();
      const opId = `op-${this.runId}-${opIdx}`;
      const reqId = `req-${this.runId}-${opIdx}`;

      const startNs = this.clock.nowNs();

      if (isRead) {
        const trace = await new Promise<OperationTrace>((resolve) => {
          this.nodeClient.Get(
            { key },
            { deadline: new Date(Date.now() + 3000) },
            (err: any, resp: any) => {
              const endNs = this.clock.nowNs();
              const latencyMs = Number(endNs - startNs) / 1_000_000;
              latencies.push(latencyMs);

              if (err) {
                resolve({
                  opIndex: opIdx,
                  type: 'GET',
                  key,
                  success: false,
                  latencyMs,
                  error: err.message,
                  startMonotonicNs: startNs,
                  endMonotonicNs: endNs
                });
              } else {
                resolve({
                  opIndex: opIdx,
                  type: 'GET',
                  key,
                  success: resp.status?.code === 1 || resp.status?.code === 'STATUS_CODE_OK',
                  latencyMs,
                  version: resp.key_state?.entries?.[0]?.version,
                  startMonotonicNs: startNs,
                  endMonotonicNs: endNs
                });
              }
            }
          );
        });
        traces.push(trace);
      } else {
        const valueStr = `val-${this.runId}-${opIdx}`;
        const trace = await new Promise<OperationTrace>((resolve) => {
          this.nodeClient.Put(
            {
              key,
              value: Buffer.from(valueStr),
              run_id: this.runId,
              client_id: this.clientId,
              operation_id: opId,
              request_id: reqId
            },
            { deadline: new Date(Date.now() + 3000) },
            (err: any, resp: any) => {
              const endNs = this.clock.nowNs();
              const latencyMs = Number(endNs - startNs) / 1_000_000;
              latencies.push(latencyMs);

              if (err) {
                resolve({
                  opIndex: opIdx,
                  type: 'PUT',
                  key,
                  success: false,
                  latencyMs,
                  error: err.message,
                  startMonotonicNs: startNs,
                  endMonotonicNs: endNs
                });
              } else {
                resolve({
                  opIndex: opIdx,
                  type: 'PUT',
                  key,
                  success: resp.status?.code === 1 || resp.status?.code === 'STATUS_CODE_OK',
                  latencyMs,
                  version: resp.version,
                  startMonotonicNs: startNs,
                  endMonotonicNs: endNs
                });
              }
            }
          );
        });
        traces.push(trace);
      }
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

    const successful = traces.filter((t) => t.success).length;
    const failed = traces.length - successful;

    return {
      totalOperations: traces.length,
      successfulOperations: successful,
      failedOperations: failed,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      traces
    };
  }
}
