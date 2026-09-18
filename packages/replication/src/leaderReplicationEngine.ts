import {
  ReplicationEngine,
  ReplicationPutParams,
  ReplicationDeleteParams,
  ReplicationGetParams,
  ReplicationResult,
  ReplicationGetResult,
  ReplicaAckInfo
} from './types.js';
import { PeerClientPool } from './peerClient.js';
import { MembershipSnapshot } from '@quorum-lab/contracts';
import { VersionedEntry } from '@quorum-lab/consistency';
import { LocalNodeOperations } from './syncReplicationEngine.js';

export class NotLeaderError extends Error {
  public readonly currentLeaderId?: string;
  constructor(message: string, currentLeaderId?: string) {
    super(message);
    this.name = 'NotLeaderError';
    this.currentLeaderId = currentLeaderId;
  }
}

export class UnsafeLeaderError extends Error {
  public readonly leaseExpiredAt: number;
  constructor(message: string, leaseExpiredAt: number) {
    super(message);
    this.name = 'UnsafeLeaderError';
    this.leaseExpiredAt = leaseExpiredAt;
  }
}

export class FencingViolationError extends Error {
  public readonly incomingEpoch: number;
  public readonly currentEpoch: number;
  constructor(message: string, incomingEpoch: number, currentEpoch: number) {
    super(message);
    this.name = 'FencingViolationError';
    this.incomingEpoch = incomingEpoch;
    this.currentEpoch = currentEpoch;
  }
}

export interface FencingCoordinatorOptions {
  readonly initialEpoch?: number;
  readonly initialLeaderId?: string;
  readonly leaseDurationMs?: number;
}

export class FencingCoordinator {
  private currentEpoch: number;
  private currentLeaderId?: string;
  private readonly leaseDurationMs: number;
  private leaseExpiresAt: number;

  constructor(options?: FencingCoordinatorOptions) {
    this.currentEpoch = options?.initialEpoch ?? 1;
    this.currentLeaderId = options?.initialLeaderId;
    this.leaseDurationMs = options?.leaseDurationMs ?? 5000;
    this.leaseExpiresAt = options?.initialLeaderId ? Date.now() + this.leaseDurationMs : 0;
  }

  public getEpoch(): number {
    return this.currentEpoch;
  }

  public getLeaderId(): string | undefined {
    return this.currentLeaderId;
  }

  public isLeader(nodeId: string): boolean {
    return this.currentLeaderId === nodeId;
  }

  public isLeaseValid(nowMs: number = Date.now()): boolean {
    return this.leaseExpiresAt > nowMs;
  }

  public getLeaseExpiresAt(): number {
    return this.leaseExpiresAt;
  }

  public renewLease(durationMs?: number): void {
    const dur = durationMs ?? this.leaseDurationMs;
    this.leaseExpiresAt = Date.now() + dur;
  }

  public acquireLeadership(nodeId: string, epoch?: number, leaseDurationMs?: number): number {
    if (epoch !== undefined) {
      if (epoch < this.currentEpoch) {
        throw new FencingViolationError(
          `Cannot acquire leadership with epoch ${epoch} < current epoch ${this.currentEpoch}`,
          epoch,
          this.currentEpoch
        );
      }
      this.currentEpoch = epoch;
    } else {
      this.currentEpoch += 1;
    }
    this.currentLeaderId = nodeId;
    const dur = leaseDurationMs ?? this.leaseDurationMs;
    this.leaseExpiresAt = Date.now() + dur;
    return this.currentEpoch;
  }

  public stepDown(newLeaderId?: string): void {
    this.currentLeaderId = newLeaderId;
    this.leaseExpiresAt = 0;
  }

  public verifyFencingEpoch(incomingEpoch: number): { valid: boolean; currentEpoch: number } {
    return {
      valid: incomingEpoch >= this.currentEpoch,
      currentEpoch: this.currentEpoch
    };
  }

  public adoptEpoch(incomingEpoch: number, leaderId?: string): void {
    if (incomingEpoch > this.currentEpoch) {
      this.currentEpoch = incomingEpoch;
      this.currentLeaderId = leaderId;
      this.leaseExpiresAt = 0; // step down if we were previously leader
    }
  }
}

export interface LeaderReplicationConfig {
  readonly W: number;
  readonly R: number;
}

export class LeaderReplicationEngine implements ReplicationEngine {
  public readonly localNodeId: string;
  private readonly localOps: LocalNodeOperations;
  public readonly peerPool: PeerClientPool;
  private readonly getMembership: () => MembershipSnapshot;
  public readonly fencingCoordinator: FencingCoordinator;
  public readonly quorumConfig: LeaderReplicationConfig;

  constructor(params: {
    localNodeId: string;
    localOps: LocalNodeOperations;
    peerPool: PeerClientPool;
    getMembership: () => MembershipSnapshot;
    fencingCoordinator: FencingCoordinator;
    quorumConfig?: LeaderReplicationConfig;
  }) {
    this.localNodeId = params.localNodeId;
    this.localOps = params.localOps;
    this.peerPool = params.peerPool;
    this.getMembership = params.getMembership;
    this.fencingCoordinator = params.fencingCoordinator;
    this.quorumConfig = params.quorumConfig ?? { W: 2, R: 1 };
  }

  public async put(params: ReplicationPutParams): Promise<ReplicationResult> {
    if (!this.fencingCoordinator.isLeader(this.localNodeId)) {
      throw new NotLeaderError(
        `Node ${this.localNodeId} is not the designated leader for epoch ${this.fencingCoordinator.getEpoch()}`,
        this.fencingCoordinator.getLeaderId()
      );
    }

    if (!this.fencingCoordinator.isLeaseValid()) {
      throw new UnsafeLeaderError(
        `Leader ${this.localNodeId} lease has expired at ${this.fencingCoordinator.getLeaseExpiresAt()}`,
        this.fencingCoordinator.getLeaseExpiresAt()
      );
    }

    const epoch = this.fencingCoordinator.getEpoch();
    const localStart = process.hrtime.bigint();
    const localRes = await this.localOps.put(params);
    const localElapsedNs = process.hrtime.bigint() - localStart;

    const localAck: ReplicaAckInfo = {
      nodeId: this.localNodeId,
      replicaAcked: true,
      durableAcked: this.localOps.isDurable(),
      latencyMs: Number(localElapsedNs) / 1_000_000
    };

    if (localRes.isDuplicate) {
      return {
        version: localRes.version,
        frontier: localRes.frontier,
        replicaAcks: [localAck],
        totalReplicaAcks: 1,
        totalDurableAcks: localAck.durableAcked ? 1 : 0,
        isDuplicate: true
      };
    }

    const { W } = this.quorumConfig;
    const acks: ReplicaAckInfo[] = [localAck];
    const membership = this.getMembership();
    const peers = membership.members.filter((id) => id !== this.localNodeId);

    const entry: VersionedEntry = {
      value: params.value,
      tombstone: false,
      version: localRes.version
    };

    if (W > 1 && peers.length > 0) {
      const peerAcks = await Promise.all(
        peers.map(async (peerId) => {
          const pAck = await this.peerPool.replicateToPeer({
            peerNodeId: peerId,
            sourceNodeId: this.localNodeId,
            key: params.key,
            entry,
            operationId: params.operationId,
            requestId: params.requestId,
            membership,
            fencingEpoch: epoch
          });

          if (pAck.error && pAck.error.includes('Fencing violation')) {
            // Stepped down by higher epoch peer
            this.fencingCoordinator.stepDown();
          }
          return pAck;
        })
      );

      for (const pAck of peerAcks) {
        acks.push(pAck);
      }
    }

    const totalReplicaAcks = acks.filter((a) => a.replicaAcked).length;
    const totalDurableAcks = acks.filter((a) => a.durableAcked).length;

    if (totalReplicaAcks < W) {
      throw new Error(`Leader replication W=${W} not satisfied; only ${totalReplicaAcks} replicas acknowledged`);
    }

    // Successfully committed to quorum: renew lease
    this.fencingCoordinator.renewLease();

    return {
      version: localRes.version,
      frontier: localRes.frontier,
      replicaAcks: acks,
      totalReplicaAcks,
      totalDurableAcks,
      isDuplicate: false
    };
  }

  public async delete(params: ReplicationDeleteParams): Promise<ReplicationResult> {
    if (!this.fencingCoordinator.isLeader(this.localNodeId)) {
      throw new NotLeaderError(
        `Node ${this.localNodeId} is not the designated leader for epoch ${this.fencingCoordinator.getEpoch()}`,
        this.fencingCoordinator.getLeaderId()
      );
    }

    if (!this.fencingCoordinator.isLeaseValid()) {
      throw new UnsafeLeaderError(
        `Leader ${this.localNodeId} lease has expired at ${this.fencingCoordinator.getLeaseExpiresAt()}`,
        this.fencingCoordinator.getLeaseExpiresAt()
      );
    }

    const epoch = this.fencingCoordinator.getEpoch();
    const localStart = process.hrtime.bigint();
    const localRes = await this.localOps.delete(params);
    const localElapsedNs = process.hrtime.bigint() - localStart;

    const localAck: ReplicaAckInfo = {
      nodeId: this.localNodeId,
      replicaAcked: true,
      durableAcked: this.localOps.isDurable(),
      latencyMs: Number(localElapsedNs) / 1_000_000
    };

    if (localRes.isDuplicate) {
      return {
        version: localRes.tombstoneVersion,
        frontier: localRes.frontier,
        replicaAcks: [localAck],
        totalReplicaAcks: 1,
        totalDurableAcks: localAck.durableAcked ? 1 : 0,
        isDuplicate: true
      };
    }

    const { W } = this.quorumConfig;
    const acks: ReplicaAckInfo[] = [localAck];
    const membership = this.getMembership();
    const peers = membership.members.filter((id) => id !== this.localNodeId);

    const entry: VersionedEntry = {
      value: null,
      tombstone: true,
      version: localRes.tombstoneVersion
    };

    if (W > 1 && peers.length > 0) {
      const peerAcks = await Promise.all(
        peers.map(async (peerId) => {
          const pAck = await this.peerPool.replicateToPeer({
            peerNodeId: peerId,
            sourceNodeId: this.localNodeId,
            key: params.key,
            entry,
            operationId: params.operationId,
            requestId: params.requestId,
            membership,
            fencingEpoch: epoch
          });

          if (pAck.error && pAck.error.includes('Fencing violation')) {
            this.fencingCoordinator.stepDown();
          }
          return pAck;
        })
      );

      for (const pAck of peerAcks) {
        acks.push(pAck);
      }
    }

    const totalReplicaAcks = acks.filter((a) => a.replicaAcked).length;
    const totalDurableAcks = acks.filter((a) => a.durableAcked).length;

    if (totalReplicaAcks < W) {
      throw new Error(`Leader replication W=${W} not satisfied; only ${totalReplicaAcks} replicas acknowledged`);
    }

    this.fencingCoordinator.renewLease();

    return {
      version: localRes.tombstoneVersion,
      frontier: localRes.frontier,
      replicaAcks: acks,
      totalReplicaAcks,
      totalDurableAcks,
      isDuplicate: false
    };
  }

  public async get(params: ReplicationGetParams): Promise<ReplicationGetResult> {
    const localRes = this.localOps.get(params);
    return {
      keyState: localRes.keyState,
      frontier: localRes.frontier
    };
  }

  public async close(): Promise<void> {
    // No-op
  }
}
