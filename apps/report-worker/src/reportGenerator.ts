import { AnalysisSummary, QuorumExperimentReport, PerformanceMetrics } from './types.js';

export class ReportGenerator {
  public static calculateQuantile(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(q * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
  }

  public static generateReport(
    runId: string,
    durationMs: number,
    latencies: readonly number[],
    analysis: AnalysisSummary
  ): QuorumExperimentReport {
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const count = sorted.length;

    const p50 = this.calculateQuantile(sorted, 0.5);
    const p90 = this.calculateQuantile(sorted, 0.9);
    const p95 = this.calculateQuantile(sorted, 0.95);
    const p99 = this.calculateQuantile(sorted, 0.99);
    const max = sorted[sorted.length - 1] ?? 0;
    const mean = count > 0 ? sum / count : 0;
    const rps = durationMs > 0 ? analysis.totalOperations / (durationMs / 1000) : 0;

    const metrics: PerformanceMetrics = {
      throughputRps: Number(rps.toFixed(2)),
      p50LatencyMs: Number(p50.toFixed(2)),
      p90LatencyMs: Number(p90.toFixed(2)),
      p95LatencyMs: Number(p95.toFixed(2)),
      p99LatencyMs: Number(p99.toFixed(2)),
      maxLatencyMs: Number(max.toFixed(2)),
      meanLatencyMs: Number(mean.toFixed(2)),
    };

    const sloStatus = {
      availability: analysis.successRate >= 0.99 ? ('PASS' as const) : ('FAIL' as const),
      p99Latency: p99 <= 100 ? ('PASS' as const) : ('FAIL' as const),
      errorRate: 1 - analysis.successRate <= 0.01 ? ('PASS' as const) : ('FAIL' as const),
    };

    return {
      runId,
      timestamp: new Date().toISOString(),
      durationMs,
      metrics,
      analysis,
      sloStatus,
    };
  }

  public static renderHtml(report: QuorumExperimentReport): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>QUORUM LAB Report — ${report.runId}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; border: 1px solid #334155; }
    h1 { color: #38bdf8; }
    .badge { padding: 4px 10px; border-radius: 4px; font-weight: bold; }
    .badge-pass { background: #065f46; color: #34d399; }
    .badge-fail { background: #991b1b; color: #f87171; }
  </style>
</head>
<body>
  <h1>QUORUM LAB Execution Report</h1>
  <div class="card">
    <p><strong>Run ID:</strong> ${report.runId}</p>
    <p><strong>Throughput:</strong> ${report.metrics.throughputRps} RPS</p>
    <p><strong>P99 Latency:</strong> ${report.metrics.p99LatencyMs} ms</p>
    <p><strong>Success Rate:</strong> ${(report.analysis.successRate * 100).toFixed(1)}%</p>
  </div>
</body>
</html>`;
  }
}
