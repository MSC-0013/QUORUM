import crypto from 'node:crypto';

/**
 * Derives a deterministic 32-bit unsigned integer seed from a root seed and stream identifier.
 * subSeed = SHA256(rootSeed + ":" + streamName + ":" + streamIdentity)[0..3]
 */
export function deriveStreamSeed(
  rootSeed: string,
  streamName: string,
  streamIdentity: string
): number {
  const hash = crypto
    .createHash('sha256')
    .update(`${rootSeed}:${streamName}:${streamIdentity}`)
    .digest();
  return hash.readUInt32BE(0);
}

/**
 * High-quality 32-bit deterministic PRNG based on Mulberry32.
 */
export class DeterministicRng {
  private state: number;

  constructor(seed: number | string) {
    if (typeof seed === 'string') {
      this.state = deriveStreamSeed(seed, 'default', '0');
    } else {
      this.state = seed >>> 0;
    }
  }

  /**
   * Returns a pseudo-random 32-bit unsigned integer.
   */
  public nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /**
   * Returns a pseudo-random float in the half-open interval [0, 1).
   */
  public nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Returns a pseudo-random integer in [min, max] inclusive.
   */
  public nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error(`min (${min}) must be <= max (${max})`);
    }
    const range = max - min + 1;
    return min + Math.floor(this.nextFloat() * range);
  }

  /**
   * Returns true with the given probability in [0, 1].
   */
  public nextBool(probability = 0.5): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.nextFloat() < probability;
  }

  /**
   * Samples a random element from a non-empty array.
   */
  public sample<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot sample from an empty array');
    }
    const idx = this.nextInt(0, items.length - 1);
    return items[idx]!;
  }

  /**
   * Samples a rank in [1, n] according to a Zipfian distribution with skew parameter s (s >= 0).
   * s = 0 is uniform; s = 1 is standard Zipfian (80/20 rule).
   */
  public sampleZipfian(n: number, s = 1.0): number {
    if (n <= 1) return 1;
    if (s <= 0) return this.nextInt(1, n);

    // Compute harmonic sum
    let harmonicSum = 0;
    for (let i = 1; i <= n; i++) {
      harmonicSum += 1 / Math.pow(i, s);
    }

    const u = this.nextFloat() * harmonicSum;
    let cum = 0;
    for (let i = 1; i <= n; i++) {
      cum += 1 / Math.pow(i, s);
      if (cum >= u) {
        return i;
      }
    }
    return n;
  }
}
