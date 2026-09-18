import { describe, it, expect } from 'vitest';
import {
  ClientSessionContext,
  SessionGuaranteeVerifier
} from '../src/sessionGuarantees.js';
import { createVersionStamp } from '../src/versionStamp.js';
import { toVersionFrontier } from '../src/versionFrontier.js';

describe('Client Session Guarantees (§Q7)', () => {
  it('enforces Read-Your-Writes (RYW): written version must be visible in subsequent reads', () => {
    const session = new ClientSessionContext('client-sess-1');

    const writeVersion = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1 },
      lamport: 1,
      wallTimeMs: 1000
    });

    session.recordWrite(writeVersion);
    expect(session.getFrontier()['node-a']).toBe(1);

    // Stale replica without the write
    const staleFrontier = toVersionFrontier({
      key: 'key-1',
      entries: []
    });
    expect(session.satisfiesSession(staleFrontier)).toBe(false);

    // Replica that has incorporated the write
    const updatedFrontier = toVersionFrontier({
      key: 'key-1',
      entries: [
        {
          value: Buffer.from('val-1'),
          tombstone: false,
          version: writeVersion
        }
      ]
    });
    expect(session.satisfiesSession(updatedFrontier)).toBe(true);
    expect(SessionGuaranteeVerifier.verifyReadYourWrites(writeVersion, updatedFrontier)).toBe(true);
  });

  it('enforces Monotonic Reads (MR): subsequent reads never observe older versions', () => {
    const session = new ClientSessionContext('client-sess-2');

    const v1 = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1 },
      lamport: 1,
      wallTimeMs: 1000
    });

    const v2 = createVersionStamp({
      nodeId: 'node-a',
      counter: 2,
      vectorClock: { 'node-a': 2 },
      lamport: 2,
      wallTimeMs: 2000
    });

    const frontierV1 = toVersionFrontier({
      key: 'k-1',
      entries: [{ value: Buffer.from('v1'), tombstone: false, version: v1 }]
    });

    const frontierV2 = toVersionFrontier({
      key: 'k-1',
      entries: [{ value: Buffer.from('v2'), tombstone: false, version: v2 }]
    });

    // First read observes v2
    session.recordRead(frontierV2);
    expect(session.getFrontier()['node-a']).toBe(2);

    // Stale replica still at v1 is rejected (prevents backwards time travel)
    expect(session.satisfiesSession(frontierV1)).toBe(false);
    expect(SessionGuaranteeVerifier.verifyMonotonicReads(frontierV2, frontierV1)).toBe(false);

    // Up-to-date replica at v2 is accepted
    expect(session.satisfiesSession(frontierV2)).toBe(true);
    expect(SessionGuaranteeVerifier.verifyMonotonicReads(frontierV1, frontierV2)).toBe(true);
  });

  it('enforces Writes-Follow-Reads (WFR) and Monotonic Writes (MW)', () => {
    const session = new ClientSessionContext('client-sess-3');

    // 1. Read from node-b at counter 5
    const observedFromB = createVersionStamp({
      nodeId: 'node-b',
      counter: 5,
      vectorClock: { 'node-b': 5 },
      lamport: 5,
      wallTimeMs: 1500
    });
    session.recordRead(
      toVersionFrontier({
        key: 'observed-key',
        entries: [{ value: Buffer.from('data'), tombstone: false, version: observedFromB }]
      })
    );

    // 2. Client then executes a write on node-a
    const writeOnA = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1, 'node-b': 5 }, // causally incorporates read from node-b
      lamport: 6,
      wallTimeMs: 2000
    });
    session.recordWrite(writeOnA);

    const frontier = session.getFrontier();
    expect(frontier['node-b']).toBe(5);
    expect(frontier['node-a']).toBe(1);
  });

  it('serializes and deserializes portable session tokens', () => {
    const session = new ClientSessionContext('client-sess-token', { 'node-1': 3, 'node-2': 7 });
    const token = session.encodeToken();
    expect(typeof token).toBe('string');

    const restored = ClientSessionContext.decodeToken(token);
    expect(restored.sessionId).toBe('client-sess-token');
    expect(restored.getFrontier()).toEqual({ 'node-1': 3, 'node-2': 7 });
  });
});
