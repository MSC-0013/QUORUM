import { describe, it, expect } from 'vitest';
import { crc32c } from '../src/index.js';

describe('Storage: CRC32C (Castagnoli)', () => {
  it('computes 0 for empty buffer', () => {
    expect(crc32c(new Uint8Array(0))).toBe(0);
  });

  it('matches standard CRC32C test vector "123456789"', () => {
    const data = Buffer.from('123456789', 'ascii');
    // Standard Castagnoli CRC32C for "123456789" is 0xE3069283
    const checksum = crc32c(data);
    expect(checksum).toBe(0xe3069283 >>> 0);
  });

  it('detects single-bit differences in payload', () => {
    const b1 = Buffer.from('Hello, Distributed Laboratory!');
    const b2 = Buffer.from('Hello, Distributed Laboratory.'); // 1 byte changed

    const c1 = crc32c(b1);
    const c2 = crc32c(b2);

    expect(c1).not.toBe(c2);
  });
});
