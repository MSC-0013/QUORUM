import {
  ReplicationEngine,
  ReplicationPutParams,
  ReplicationDeleteParams,
  ReplicationGetParams,
  ReplicationResult,
  ReplicationGetResult,
  ReplicaAckInfo
} from './types.js';
import { RaftNode } from './raftNode.js';
import { LocalNodeOperations } from './syncReplicationEngine.js';

export interface RaftCommandPayload {
  type: 'PUT' | 'DELETE';
  key: string;
  value?: number[];
  clientId: string;
  requestId: string;
  operationId: string;
  runId: string;
}

export class RaftReplicationEngine implements ReplicationEngine {
  public readonly localNodeId: string;
  public readonly raftNode: RaftNode;
  private readonly localOps: LocalNodeOperations;

  constructor(params: {
    localNodeId: string;
    raftNode: RaftNode;
    localOps: LocalNodeOperations;
  }) {
    this.localNodeId = params.localNodeId;
    this.raftNode = params.raftNode;
    this.localOps = params.localOps;
  }

  public async put(params: ReplicationPutParams): Promise<ReplicationResult> {
    const payload: RaftCommandPayload = {
      type: 'PUT',
      key: params.key,
      value: Array.from(params.value),
      clientId: params.clientId,
      requestId: params.requestId,
      operationId: params.operationId,
      runId: params.runId
    };

    const serialized = Buffer.from(JSON.stringify(payload), 'utf8');
    const { entry, result } = await this.raftNode.propose(serialized);

    const matchCount = Array.from(this.raftNode.matchIndex.values()).filter((idx) => idx >= entry.index).length + 1;

    const replicaAcks: ReplicaAckInfo[] = [
      {
        nodeId: this.localNodeId,
        replicaAcked: true,
        durableAcked: this.localOps.isDurable(),
        latencyMs: 1
      }
    ];

    for (const [peerId, idx] of this.raftNode.matchIndex.entries()) {
      replicaAcks.push({
        nodeId: peerId,
        replicaAcked: idx >= entry.index,
        durableAcked: idx >= entry.index,
        latencyMs: 1
      });
    }

    return {
      version: result.version,
      frontier: result.frontier,
      replicaAcks,
      totalReplicaAcks: matchCount,
      totalDurableAcks: matchCount,
      isDuplicate: Boolean(result.isDuplicate)
    };
  }

  public async delete(params: ReplicationDeleteParams): Promise<ReplicationResult> {
    const payload: RaftCommandPayload = {
      type: 'DELETE',
      key: params.key,
      clientId: params.clientId,
      requestId: params.requestId,
      operationId: params.operationId,
      runId: params.runId
    };

    const serialized = Buffer.from(JSON.stringify(payload), 'utf8');
    const { entry, result } = await this.raftNode.propose(serialized);

    const matchCount = Array.from(this.raftNode.matchIndex.values()).filter((idx) => idx >= entry.index).length + 1;

    const replicaAcks: ReplicaAckInfo[] = [
      {
        nodeId: this.localNodeId,
        replicaAcked: true,
        durableAcked: this.localOps.isDurable(),
        latencyMs: 1
      }
    ];

    for (const [peerId, idx] of this.raftNode.matchIndex.entries()) {
      replicaAcks.push({
        nodeId: peerId,
        replicaAcked: idx >= entry.index,
        durableAcked: idx >= entry.index,
        latencyMs: 1
      });
    }

    return {
      version: result.tombstoneVersion,
      frontier: result.frontier,
      replicaAcks,
      totalReplicaAcks: matchCount,
      totalDurableAcks: matchCount,
      isDuplicate: Boolean(result.isDuplicate)
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
