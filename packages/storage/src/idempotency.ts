import { createHash } from 'node:crypto';
import {
  IdempotencyRecord,
  IdempotencyConflictError
} from './types.js';

export class IdempotencyTable {
  private readonly records = new Map<string, IdempotencyRecord>();

  /**
   * Computes the deterministic SHA-256 hash of a canonical request payload.
   */
  public static hashPayload(payload: unknown): string {
    const canonicalString = JSON.stringify(payload, Object.keys(payload as any).sort());
    return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }

  private makeKey(clientId: string, requestId: string): string {
    return `${clientId}:${requestId}`;
  }

  /**
   * Checks whether the request has already been recorded.
   * If recorded with identical payloadHash: returns existing IdempotencyRecord.
   * If recorded with different payloadHash: throws IdempotencyConflictError.
   * If not recorded: returns null.
   */
  public check(clientId: string, requestId: string, payloadHash: string): IdempotencyRecord | null {
    const key = this.makeKey(clientId, requestId);
    const existing = this.records.get(key);
    if (!existing) return null;

    if (existing.payloadHash !== payloadHash) {
      throw new IdempotencyConflictError(clientId, requestId);
    }

    return existing;
  }

  /**
   * Records or updates an idempotency record.
   */
  public record(entry: IdempotencyRecord): void {
    const key = this.makeKey(entry.clientId, entry.requestId);
    this.records.set(key, Object.freeze({ ...entry }));
  }

  public get(clientId: string, requestId: string): IdempotencyRecord | undefined {
    return this.records.get(this.makeKey(clientId, requestId));
  }

  public size(): number {
    return this.records.size;
  }

  public clear(): void {
    this.records.clear();
  }
}
