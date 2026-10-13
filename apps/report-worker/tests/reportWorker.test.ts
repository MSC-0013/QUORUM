import { describe, it, expect } from 'vitest';
import { ReportGenerator } from '../src/reportGenerator.js';
import { AnalysisSummary } from '@quorum-lab/analysis-worker';

describe('ReportWorker: ReportGenerator', () => {
  it('correctly calculates latency percentiles and generates report', () => {
    const latencies = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
    const mockAnalysis: AnalysisSummary = {
      totalOperations: 10,
      reads: 5,
      writes: 5,
      successRate: 1.0,
      verdicts: {
        staleReads: 'PASS',
        readYourWrites: 'PASS',
        monotonicReads: 'PASS',
        causalConsistency: 'PASS',
      },
      violations: [],
      detectedConflicts: 0,
    };

    const report = ReportGenerator.generateReport('test-run-1', 1000, latencies, mockAnalysis);

    expect(report.runId).toBe('test-run-1');
    expect(report.metrics.throughputRps).toBe(10);
    expect(report.metrics.p50LatencyMs).toBe(25);
    expect(report.metrics.maxLatencyMs).toBe(100);
    expect(report.sloStatus.availability).toBe('PASS');
    expect(report.sloStatus.p99Latency).toBe('PASS');
  });

  it('renders valid HTML containing the run id', () => {
    const mockAnalysis: AnalysisSummary = {
      totalOperations: 1,
      reads: 1,
      writes: 0,
      successRate: 1.0,
      verdicts: {
        staleReads: 'PASS',
        readYourWrites: 'PASS',
        monotonicReads: 'PASS',
        causalConsistency: 'PASS',
      },
      violations: [],
      detectedConflicts: 0,
    };

    const report = ReportGenerator.generateReport('html-test-run', 500, [12], mockAnalysis);
    const html = ReportGenerator.renderHtml(report);

    expect(html).toContain('html-test-run');
    expect(html).toContain('QUORUM LAB');
  });
});
