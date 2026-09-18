import { createPrng, KeyGenerator, UniformGenerator, ZipfianGenerator } from './distributions.js';

export type WorkloadProfile = 'READ_HEAVY' | 'WRITE_HEAVY' | 'BALANCED';

export interface BenchmarkWorkloadConfig {
  readonly keyspaceSize: number;
  readonly distribution: 'UNIFORM' | 'ZIPFIAN';
  readonly profile: WorkloadProfile;
  readonly totalOperations: number;
  readonly concurrency?: number;
  readonly seed?: number;
  readonly keyPrefix?: string;
  readonly valueSizeBytes?: number;
}

export interface WorkloadOperation {
  readonly type: 'GET' | 'PUT';
  readonly key: string;
  readonly value?: Uint8Array;
}

/**
 * Generates reproducible deterministic workload sequences according to specified distributions.
 */
export class WorkloadGenerator {
  private readonly config: BenchmarkWorkloadConfig;
  private readonly keyGen: KeyGenerator;
  private readonly rng: () => number;
  private readonly readRatio: number;
  private readonly valueTemplate: Uint8Array;

  constructor(config: BenchmarkWorkloadConfig) {
    this.config = config;
    const seed = config.seed ?? 42;
    this.rng = createPrng(seed);

    if (config.distribution === 'ZIPFIAN') {
      this.keyGen = new ZipfianGenerator(config.keyspaceSize, 0.99, seed + 1, config.keyPrefix);
    } else {
      this.keyGen = new UniformGenerator(config.keyspaceSize, seed + 1, config.keyPrefix);
    }

    if (config.profile === 'READ_HEAVY') {
      this.readRatio = 0.9;
    } else if (config.profile === 'WRITE_HEAVY') {
      this.readRatio = 0.1;
    } else {
      this.readRatio = 0.5;
    }

    const valSize = config.valueSizeBytes ?? 64;
    this.valueTemplate = new Uint8Array(valSize);
    for (let i = 0; i < valSize; i++) {
      this.valueTemplate[i] = (i % 26) + 65; // ASCII 'A'-'Z'
    }
  }

  public nextOperation(): WorkloadOperation {
    const isRead = this.rng() < this.readRatio;
    const key = this.keyGen.nextKey();

    if (isRead) {
      return { type: 'GET', key };
    }

    // Generate unique mutation payload with stamp
    const payload = new Uint8Array(this.valueTemplate.length);
    payload.set(this.valueTemplate);
    return { type: 'PUT', key, value: payload };
  }

  public generateAll(): WorkloadOperation[] {
    const ops: WorkloadOperation[] = new Array(this.config.totalOperations);
    for (let i = 0; i < this.config.totalOperations; i++) {
      ops[i] = this.nextOperation();
    }
    return ops;
  }
}
