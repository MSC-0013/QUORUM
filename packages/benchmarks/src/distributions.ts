/**
 * Mulberry32 32-bit deterministic PRNG.
 * Produces identical pseudo-random sequences for identical seeds across all platforms.
 */
export function createPrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface KeyGenerator {
  nextKey(): string;
}

/**
 * Uniform distribution key generator.
 */
export class UniformGenerator implements KeyGenerator {
  private readonly rng: () => number;
  private readonly keyspaceSize: number;
  private readonly prefix: string;

  constructor(keyspaceSize: number, seed = 42, prefix = 'key:') {
    this.keyspaceSize = Math.max(1, keyspaceSize);
    this.rng = createPrng(seed);
    this.prefix = prefix;
  }

  public nextKey(): string {
    const idx = Math.floor(this.rng() * this.keyspaceSize);
    return `${this.prefix}${idx}`;
  }
}

/**
 * Zipfian distribution generator (YCSB standard algorithm).
 * Simulates heavy-tailed hot-key distributions (top 1% receives majority of requests).
 */
export class ZipfianGenerator implements KeyGenerator {
  private readonly rng: () => number;
  private readonly keyspaceSize: number;
  private readonly prefix: string;
  private readonly theta: number;
  private readonly alpha: number;
  private readonly zetan: number;
  private readonly eta: number;

  constructor(keyspaceSize: number, theta = 0.99, seed = 42, prefix = 'key:') {
    this.keyspaceSize = Math.max(1, keyspaceSize);
    this.theta = theta;
    this.rng = createPrng(seed);
    this.prefix = prefix;

    this.alpha = 1 / (1 - theta);
    this.zetan = this.computeZeta(this.keyspaceSize, theta);
    const zeta2 = this.computeZeta(2, theta);
    this.eta = (1 - Math.pow(2 / this.keyspaceSize, 1 - theta)) / (1 - zeta2 / this.zetan);
  }

  private computeZeta(n: number, theta: number): number {
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      sum += 1 / Math.pow(i, theta);
    }
    return sum;
  }

  public nextKey(): string {
    const u = this.rng();
    const uz = u * this.zetan;
    let idx: number;

    if (uz < 1) {
      idx = 0;
    } else if (uz < 1 + Math.pow(0.5, this.theta)) {
      idx = 1;
    } else {
      idx = Math.floor(this.keyspaceSize * Math.pow(this.eta * u - this.eta + 1, this.alpha));
    }

    // Clamp within bounds
    idx = Math.max(0, Math.min(this.keyspaceSize - 1, idx));
    return `${this.prefix}${idx}`;
  }
}
