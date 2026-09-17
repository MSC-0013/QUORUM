import { VersionStamp } from '@quorum-lab/consistency';
import {
  WalRecordType,
  WalRecordEnvelope,
  IdempotencyRecord
} from './types.js';

export interface PutPayload {
  key: string;
  value: Uint8Array;
  tombstone: boolean;
  version: VersionStamp;
  clientId: string;
  requestId: string;
  operationId: string;
}

export interface DeletePayload {
  key: string;
  version: VersionStamp;
  clientId: string;
  requestId: string;
  operationId: string;
}

export interface SnapshotMarkerPayload {
  snapshotSequence: bigint;
  snapshotPath: string;
}

/**
 * Encodes a WalRecordEnvelope into a raw binary buffer.
 * Wire format:
 * [1 byte recordType][1 byte schemaVersion][8 bytes sequence BE][4 bytes payloadLength BE][payload bytes]
 */
export function encodeWalEnvelope(envelope: WalRecordEnvelope): Uint8Array {
  const payloadLen = envelope.payload.length;
  const buffer = Buffer.allocUnsafe(14 + payloadLen);

  buffer.writeUInt8(envelope.recordType, 0);
  buffer.writeUInt8(envelope.schemaVersion, 1);
  buffer.writeBigInt64BE(BigInt(envelope.sequence), 2);
  buffer.writeUInt32BE(payloadLen, 10);
  buffer.set(envelope.payload, 14);

  return buffer;
}

/**
 * Decodes a raw binary buffer into a WalRecordEnvelope.
 */
export function decodeWalEnvelope(data: Uint8Array): WalRecordEnvelope {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buffer.length < 14) {
    throw new Error(`Envelope buffer too short: ${buffer.length} bytes, expected at least 14`);
  }

  const recordType = buffer.readUInt8(0) as WalRecordType;
  const schemaVersion = buffer.readUInt8(1);
  const sequence = buffer.readBigInt64BE(2);
  const payloadLen = buffer.readUInt32BE(10);

  if (buffer.length < 14 + payloadLen) {
    throw new Error(
      `Incomplete envelope payload: declared ${payloadLen} bytes, got ${buffer.length - 14}`
    );
  }

  const payload = buffer.subarray(14, 14 + payloadLen);

  return {
    recordType,
    sequence,
    schemaVersion,
    payload: new Uint8Array(payload)
  };
}

// Payload serialization helpers
export function serializePutPayload(payload: PutPayload): Uint8Array {
  const json = JSON.stringify({
    key: payload.key,
    value: Buffer.from(payload.value).toString('base64'),
    tombstone: payload.tombstone,
    version: payload.version,
    clientId: payload.clientId,
    requestId: payload.requestId,
    operationId: payload.operationId
  });
  return Buffer.from(json, 'utf8');
}

export function deserializePutPayload(data: Uint8Array): PutPayload {
  const parsed = JSON.parse(Buffer.from(data).toString('utf8'));
  return {
    key: parsed.key,
    value: new Uint8Array(Buffer.from(parsed.value, 'base64')),
    tombstone: parsed.tombstone,
    version: parsed.version,
    clientId: parsed.clientId,
    requestId: parsed.requestId,
    operationId: parsed.operationId
  };
}

export function serializeDeletePayload(payload: DeletePayload): Uint8Array {
  const json = JSON.stringify({
    key: payload.key,
    version: payload.version,
    clientId: payload.clientId,
    requestId: payload.requestId,
    operationId: payload.operationId
  });
  return Buffer.from(json, 'utf8');
}

export function deserializeDeletePayload(data: Uint8Array): DeletePayload {
  const parsed = JSON.parse(Buffer.from(data).toString('utf8'));
  return {
    key: parsed.key,
    version: parsed.version,
    clientId: parsed.clientId,
    requestId: parsed.requestId,
    operationId: parsed.operationId
  };
}

export function serializeSnapshotMarkerPayload(payload: SnapshotMarkerPayload): Uint8Array {
  const json = JSON.stringify({
    snapshotSequence: payload.snapshotSequence.toString(),
    snapshotPath: payload.snapshotPath
  });
  return Buffer.from(json, 'utf8');
}

export function deserializeSnapshotMarkerPayload(data: Uint8Array): SnapshotMarkerPayload {
  const parsed = JSON.parse(Buffer.from(data).toString('utf8'));
  return {
    snapshotSequence: BigInt(parsed.snapshotSequence),
    snapshotPath: parsed.snapshotPath
  };
}

export function serializeIdempotencyPayload(record: IdempotencyRecord): Uint8Array {
  const json = JSON.stringify(record);
  return Buffer.from(json, 'utf8');
}

export function deserializeIdempotencyPayload(data: Uint8Array): IdempotencyRecord {
  return JSON.parse(Buffer.from(data).toString('utf8')) as IdempotencyRecord;
}
