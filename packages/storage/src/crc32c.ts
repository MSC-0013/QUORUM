// Castagnoli CRC32-C polynomial: 0x82F63B78 (reflected 0x1EDC6F41)
const CASTAGNOLI_POLYNOMIAL = 0x82f63b78;

const TABLE = new Uint32Array(256);

// Precompute CRC table
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let bit = 0; bit < 8; bit++) {
    if (crc & 1) {
      crc = (crc >>> 1) ^ CASTAGNOLI_POLYNOMIAL;
    } else {
      crc >>>= 1;
    }
  }
  TABLE[i] = crc >>> 0;
}

/**
 * Computes the 32-bit Castagnoli CRC32C checksum of the given buffer.
 * Conforms to standard CRC-32/ISCSI test vectors (e.g. "123456789" -> 0xe3069283).
 */
export function crc32c(buf: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;

  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    crc = (TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }

  return (crc ^ 0xffffffff) >>> 0;
}
