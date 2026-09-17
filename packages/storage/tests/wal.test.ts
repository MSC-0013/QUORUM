import { describe, it, expect } from 'vitest';
import { createVersionStamp } from '@quorum-lab/consistency';
import {
  WalRecordType,
  WalRecordEnvelope,
  encodeWalEnvelope,
  decodeWalEnvelope,
  serializePutPayload,
  deserializePutPayload,
  serializeDeletePayload,
  deserializeDeletePayload,
  serializeSnapshotMarkerPayload,
  deserializeSnapshotMarkerPayload
} from '../src/index.js';

describe('Storage: WAL Encoding and Serialization', () => {
  it('encodes and decodes WalRecordEnvelope', () => {
    const payload = Buffer.from('arbitrary-test-payload-bytes');
    const envelope: WalRecordEnvelope = {
      recordType: WalRecordType.PUT,
      sequence: 42n,
      schemaVersion: 1,
      payload: new Uint8Array(payload)
    };

    const encoded = encodeWalEnvelope(envelope);
    const decoded = decodeWalEnvelope(encoded);

    expect(decoded.recordType).toBe(WalRecordType.PUT);
    expect(decoded.sequence).toBe(42n);
    expect(decoded.schemaVersion).toBe(1);
    expect(Buffer.from(decoded.payload).toString('utf8')).toBe('arbitrary-test-payload-bytes');
  });

  it('serializes and deserializes PutPayload', () => {
    const version = createVersionStamp({
      nodeId: 'node-a',
      counter: 1,
      vectorClock: { 'node-a': 1 },
      lamport: 10,
      wallTimeMs: 123456
    });

    const original = {
      key: 'user:42',
      value: new Uint8Array(Buffer.from('Alice')),
      tombstone: false,
      version,
      clientId: 'client-x',
      requestId: 'req-y',
      operationId: 'op-z'
    };

    const serialized = serializePutPayload(original);
    const deserialized = deserializePutPayload(serialized);

    expect(deserialized.key).toBe('user:42');
    expect(Buffer.from(deserialized.value).toString('utf8')).toBe('Alice');
    expect(deserialized.tombstone).toBe(false);
    expect(deserialized.version.dot.nodeId).toBe('node-a');
    expect(deserialized.clientId).toBe('client-x');
  });

  it('serializes and deserializes DeletePayload', () => {
    const version = createVersionStamp({
      nodeId: 'node-b',
      counter: 5,
      vectorClock: { 'node-b': 5 },
      lamport: 15,
      wallTimeMs: 123490
    });

    const original = {
      key: 'user:42',
      version,
      clientId: 'client-x',
      requestId: 'req-del',
      operationId: 'op-del'
    };

    const serialized = serializeDeletePayload(original);
    const deserialized = deserializeDeletePayload(serialized);

    expect(deserialized.key).toBe('user:42');
    expect(deserialized.version.dot.nodeId).toBe('node-b');
  });

  it('serializes and deserializes SnapshotMarkerPayload', () => {
    const original = {
      snapshotSequence: 1000n,
      snapshotPath: '/data/snapshots/snapshot-00000000000000001000.snap'
    };

    const serialized = serializeSnapshotMarkerPayload(original);
    const deserialized = deserializeSnapshotMarkerPayload(serialized);

    expect(deserialized.snapshotSequence).toBe(1000n);
    expect(deserialized.snapshotPath).toBe(original.snapshotPath);
  });
});
