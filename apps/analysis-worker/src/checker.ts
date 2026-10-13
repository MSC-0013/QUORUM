import { RecordedOperation, ViolationRecord, AnalysisSummary } from './types.js';

export class ConsistencyChecker {
  public static analyzeHistory(ops: readonly RecordedOperation[]): AnalysisSummary {
    const sortedOps = [...ops].sort((a, b) => a.startOffsetMs - b.startOffsetMs);

    const violations: ViolationRecord[] = [];
    let detectedConflicts = 0;

    let readCount = 0;
    let writeCount = 0;
    let successCount = 0;

    // Per client state tracking
    const clientLastWrite: Map<string, Map<string, { value?: any; counter?: number; offset: number }>> = new Map();
    const clientLastRead: Map<string, Map<string, number>> = new Map();

    // Global acknowledged write history per key
    const ackedWritesByKey: Map<string, Array<{ value?: any; counter?: number; offset: number }>> = new Map();

    for (const op of sortedOps) {
      if (op.success) successCount++;

      if (op.type === 'PUT' || op.type === 'DELETE') {
        writeCount++;
        if (op.success) {
          // Track client write
          let clientKeyMap = clientLastWrite.get(op.clientId);
          if (!clientKeyMap) {
            clientKeyMap = new Map();
            clientLastWrite.set(op.clientId, clientKeyMap);
          }
          clientKeyMap.set(op.key, {
            value: op.value,
            counter: op.versionCounter,
            offset: op.finishOffsetMs,
          });

          // Track global acked write
          let globalList = ackedWritesByKey.get(op.key);
          if (!globalList) {
            globalList = [];
            ackedWritesByKey.set(op.key, globalList);
          }
          globalList.push({
            value: op.value,
            counter: op.versionCounter,
            offset: op.finishOffsetMs,
          });
        }
      } else if (op.type === 'GET') {
        readCount++;
        if (op.success) {
          const observedCounter = op.versionCounter ?? 0;

          // 1. Check Read-Your-Writes (RYW)
          const clientWrites = clientLastWrite.get(op.clientId);
          const clientPriorWrite = clientWrites?.get(op.key);
          if (clientPriorWrite && clientPriorWrite.offset <= op.startOffsetMs) {
            const expectedCounter = clientPriorWrite.counter ?? 0;
            if (observedCounter < expectedCounter) {
              violations.push({
                violationType: 'READ_YOUR_WRITES',
                operationId: op.operationId,
                clientId: op.clientId,
                key: op.key,
                expectedVersion: `>= ${expectedCounter}`,
                observedVersion: `${observedCounter}`,
                detail: `Client read counter ${observedCounter} after previously acknowledging write with counter ${expectedCounter}`,
              });
            }
          }

          // 2. Check Monotonic Reads
          let clientReads = clientLastRead.get(op.clientId);
          if (!clientReads) {
            clientReads = new Map();
            clientLastRead.set(op.clientId, clientReads);
          }
          const prevReadCounter = clientReads.get(op.key);
          if (prevReadCounter !== undefined && observedCounter < prevReadCounter) {
            violations.push({
              violationType: 'MONOTONIC_READS',
              operationId: op.operationId,
              clientId: op.clientId,
              key: op.key,
              expectedVersion: `>= ${prevReadCounter}`,
              observedVersion: `${observedCounter}`,
              detail: `Client observed regression: read counter ${observedCounter} after prior read observed counter ${prevReadCounter}`,
            });
          }
          clientReads.set(op.key, Math.max(prevReadCounter ?? 0, observedCounter));

          // 3. Check Stale Reads against global timeline
          const keyHistory = ackedWritesByKey.get(op.key);
          if (keyHistory && keyHistory.length > 0) {
            // Find highest acked write completed strictly before this read began
            const priorAcked = keyHistory.filter((w) => w.offset < op.startOffsetMs);
            if (priorAcked.length > 0) {
              const maxPrior = Math.max(...priorAcked.map((w) => w.counter ?? 0));
              if (observedCounter < maxPrior) {
                violations.push({
                  violationType: 'STALE_READ',
                  operationId: op.operationId,
                  clientId: op.clientId,
                  key: op.key,
                  expectedVersion: `>= ${maxPrior}`,
                  observedVersion: `${observedCounter}`,
                  detail: `Read observed version ${observedCounter} when version ${maxPrior} was fully acknowledged prior to read start`,
                });
              }
            }
          }
        }
      }
    }

    const hasRyWViolation = violations.some((v) => v.violationType === 'READ_YOUR_WRITES');
    const hasMonotonicViolation = violations.some((v) => v.violationType === 'MONOTONIC_READS');
    const hasStaleViolation = violations.some((v) => v.violationType === 'STALE_READ');
    const hasCausalViolation = violations.some((v) => v.violationType === 'CAUSAL_DEPENDENCY');

    const totalOps = ops.length;
    const successRate = totalOps > 0 ? successCount / totalOps : 1.0;

    return {
      totalOperations: totalOps,
      reads: readCount,
      writes: writeCount,
      successRate,
      verdicts: {
        staleReads: hasStaleViolation ? 'VIOLATION' : 'PASS',
        readYourWrites: hasRyWViolation ? 'VIOLATION' : 'PASS',
        monotonicReads: hasMonotonicViolation ? 'VIOLATION' : 'PASS',
        causalConsistency: hasCausalViolation ? 'VIOLATION' : 'PASS',
      },
      violations,
      detectedConflicts,
    };
  }
}
