import { describe, it, expect } from 'vitest';
import { ConsistencyChecker } from '../src/checker.js';
import { RecordedOperation } from '../src/types.js';

describe('AnalysisWorker: ConsistencyChecker', () => {
  it('passes when monotonic reads and read-your-writes are respected', () => {
    const ops: RecordedOperation[] = [
      {
        operationId: 'op-1',
        clientId: 'c1',
        type: 'PUT',
        key: 'k1',
        versionCounter: 1,
        startOffsetMs: 10,
        finishOffsetMs: 20,
        targetNode: 'node-1',
        success: true,
      },
      {
        operationId: 'op-2',
        clientId: 'c1',
        type: 'GET',
        key: 'k1',
        versionCounter: 1,
        startOffsetMs: 30,
        finishOffsetMs: 40,
        targetNode: 'node-2',
        success: true,
      },
    ];

    const result = ConsistencyChecker.analyzeHistory(ops);
    expect(result.verdicts.readYourWrites).toBe('PASS');
    expect(result.verdicts.staleReads).toBe('PASS');
    expect(result.violations.length).toBe(0);
  });

  it('detects read-your-writes violations', () => {
    const ops: RecordedOperation[] = [
      {
        operationId: 'op-1',
        clientId: 'c1',
        type: 'PUT',
        key: 'k1',
        versionCounter: 5,
        startOffsetMs: 10,
        finishOffsetMs: 20,
        targetNode: 'node-1',
        success: true,
      },
      {
        operationId: 'op-2',
        clientId: 'c1',
        type: 'GET',
        key: 'k1',
        versionCounter: 2, // regressed
        startOffsetMs: 30,
        finishOffsetMs: 40,
        targetNode: 'node-2',
        success: true,
      },
    ];

    const result = ConsistencyChecker.analyzeHistory(ops);
    expect(result.verdicts.readYourWrites).toBe('VIOLATION');
    expect(result.violations.some((v) => v.violationType === 'READ_YOUR_WRITES')).toBe(true);
  });

  it('detects monotonic reads regression across multiple reads', () => {
    const ops: RecordedOperation[] = [
      {
        operationId: 'op-1',
        clientId: 'c2',
        type: 'GET',
        key: 'k1',
        versionCounter: 10,
        startOffsetMs: 10,
        finishOffsetMs: 20,
        targetNode: 'node-1',
        success: true,
      },
      {
        operationId: 'op-2',
        clientId: 'c2',
        type: 'GET',
        key: 'k1',
        versionCounter: 8, // older counter read later
        startOffsetMs: 30,
        finishOffsetMs: 40,
        targetNode: 'node-3',
        success: true,
      },
    ];

    const result = ConsistencyChecker.analyzeHistory(ops);
    expect(result.verdicts.monotonicReads).toBe('VIOLATION');
    expect(result.violations.some((v) => v.violationType === 'MONOTONIC_READS')).toBe(true);
  });
});
