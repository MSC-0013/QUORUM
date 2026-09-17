import { describe, it, expect, beforeEach } from 'vitest';
import {
  IdempotencyTable,
  IdempotencyRecord,
  IdempotencyConflictError
} from '../src/index.js';
import { createVersionStamp } from '@quorum-lab/consistency';

describe('Storage: Idempotency Dedup & Conflict Detection (§9)', () => {
  let table: IdempotencyTable;

  beforeEach(() => {
    table = new IdempotencyTable();
  });

  it('computes deterministic payload hash', () => {
    const payload1 = { b: 'two', a: 1 };
    const payload2 = { a: 1, b: 'two' }; // different key ordering

    const hash1 = IdempotencyTable.hashPayload(payload1);
    const hash2 = IdempotencyTable.hashPayload(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('records and deduplicates identical request retry', () => {
    const payload = { key: 'user:1', val: 'Alice' };
    const hash = IdempotencyTable.hashPayload(payload);

    const record: IdempotencyRecord = {
      clientId: 'client-1',
      requestId: 'req-1',
      operationId: 'op-1',
      payloadHash: hash,
      status: 'APPLIED',
      resultingVersion: createVersionStamp({
        nodeId: 'node-a',
        counter: 1,
        vectorClock: { 'node-a': 1 },
        lamport: 1,
        wallTimeMs: 1000
      })
    };

    // Initially not recorded
    expect(table.check('client-1', 'req-1', hash)).toBeNull();

    // Record it
    table.record(record);

    // Identical retry returns existing record
    const checked = table.check('client-1', 'req-1', hash);
    expect(checked).toBeDefined();
    expect(checked?.resultingVersion?.dot.counter).toBe(1);
  });

  it('throws IDEMPOTENCY_CONFLICT when retry arrives with different payload', () => {
    const originalPayload = { key: 'user:1', val: 'Alice' };
    const conflictPayload = { key: 'user:1', val: 'Bob' };

    const hashOrig = IdempotencyTable.hashPayload(originalPayload);
    const hashConflict = IdempotencyTable.hashPayload(conflictPayload);

    table.record({
      clientId: 'client-1',
      requestId: 'req-1',
      operationId: 'op-1',
      payloadHash: hashOrig,
      status: 'APPLIED'
    });

    // Replay with different payload
    expect(() => table.check('client-1', 'req-1', hashConflict)).toThrow(
      IdempotencyConflictError
    );
  });
});
