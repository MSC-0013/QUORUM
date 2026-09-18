import {
  WallClock,
  SystemWallClock,
  MonotonicClock,
  SystemMonotonicClock,
  LamportClock,
  LogicalLamportClock
} from '@quorum-lab/clocks';
import {
  VersionStamp,
  createVersionStamp
} from '@quorum-lab/consistency';

export interface NodeClocks {
  readonly wall: WallClock;
  readonly monotonic: MonotonicClock;
  readonly lamport: LamportClock;
  mintVersionStamp(vectorClock?: Record<string, number>): VersionStamp;
  getDotCounter(): number;
  setDotCounter(counter: number): void;
}

export class DefaultNodeClocks implements NodeClocks {
  public readonly wall: WallClock;
  public readonly monotonic: MonotonicClock;
  public readonly lamport: LamportClock;
  private dotCounter = 0;
  private readonly nodeId: string;

  constructor(nodeId: string, wall?: WallClock, monotonic?: MonotonicClock, lamport?: LamportClock) {
    this.nodeId = nodeId;
    this.wall = wall ?? new SystemWallClock();
    this.monotonic = monotonic ?? new SystemMonotonicClock();
    this.lamport = lamport ?? new LogicalLamportClock();
  }

  public getDotCounter(): number {
    return this.dotCounter;
  }

  public setDotCounter(counter: number): void {
    if (counter > this.dotCounter) {
      this.dotCounter = counter;
    }
  }

  public mintVersionStamp(customVectorClock?: Record<string, number>): VersionStamp {
    this.dotCounter += 1;
    const lamportVal = Number(this.lamport.tick());
    const wallMs = this.wall.nowMs();

    const vc: Record<string, number> = customVectorClock ? { ...customVectorClock } : {};
    vc[this.nodeId] = Math.max(Number(vc[this.nodeId] ?? 0), this.dotCounter);

    return createVersionStamp({
      nodeId: this.nodeId,
      counter: this.dotCounter,
      vectorClock: vc,
      lamport: lamportVal,
      wallTimeMs: wallMs
    });
  }
}
