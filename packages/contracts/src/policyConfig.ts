import {
  ReplicationEngineType,
  ReadConsistencyMode,
  WriteAckMode,
  LocalDurabilityMode,
  ConflictStrategyMode,
  assertFeatureAvailableInMilestone
} from './capabilities.js';

export interface ReadConsistencyConfig {
  readonly mode: ReadConsistencyMode;
  readonly replicas?: number;
}

export interface WriteAckConfig {
  readonly mode: WriteAckMode;
  readonly replicas?: number;
}

export interface LocalDurabilityConfig {
  readonly mode: LocalDurabilityMode;
}

export interface ConflictStrategyConfig {
  readonly mode: ConflictStrategyMode;
}

export interface ClusterPolicyConfig {
  readonly replicationEngine: ReplicationEngineType;
  readonly readConsistency: ReadConsistencyConfig;
  readonly writeAck: WriteAckConfig;
  readonly localDurability: LocalDurabilityConfig;
  readonly conflictStrategy: ConflictStrategyConfig;
}

export interface ResolvedQuorumNumbers {
  readonly N: number;
  readonly W: number;
  readonly R: number;
  readonly hasQuorumIntersection: boolean;
}

/**
 * Resolves the effective W and R integers for a given cluster size N.
 */
export function resolveQuorumNumbers(
  N: number,
  writeAck: WriteAckConfig,
  readConsistency: ReadConsistencyConfig
): ResolvedQuorumNumbers {
  if (N < 1) throw new Error(`Cluster size N must be >= 1, received ${N}`);

  const quorumThreshold = Math.floor(N / 2) + 1;

  let W = writeAck.replicas ?? (writeAck.mode === 'QUORUM' ? quorumThreshold : writeAck.mode === 'ALL' ? N : 1);
  let R = readConsistency.replicas ?? (readConsistency.mode === 'QUORUM' ? quorumThreshold : readConsistency.mode === 'ALL' ? N : 1);

  if (W > N || W < 1) {
    throw new Error(`Invalid W=${W} for cluster size N=${N}`);
  }
  if (R > N || R < 1) {
    throw new Error(`Invalid R=${R} for cluster size N=${N}`);
  }

  return {
    N,
    W,
    R,
    hasQuorumIntersection: W + R > N
  };
}

/**
 * Validates a complete 5-axis policy configuration against milestone capabilities and cluster constraints.
 */
export function validateClusterPolicyConfig(
  policy: ClusterPolicyConfig,
  clusterSize = 3,
  currentMilestoneNumber = 10,
  currentMilestoneName = 'Q10'
): { policy: ClusterPolicyConfig; quorumNumbers: ResolvedQuorumNumbers } {
  // 1. Verify capability availability per §Q3 capability table
  assertFeatureAvailableInMilestone(
    `replicationEngine:${policy.replicationEngine}`,
    currentMilestoneNumber,
    currentMilestoneName
  );
  assertFeatureAvailableInMilestone(
    `readConsistency:${policy.readConsistency.mode}`,
    currentMilestoneNumber,
    currentMilestoneName
  );
  assertFeatureAvailableInMilestone(
    `writeAck:${policy.writeAck.mode}`,
    currentMilestoneNumber,
    currentMilestoneName
  );
  assertFeatureAvailableInMilestone(
    `localDurability:${policy.localDurability.mode}`,
    currentMilestoneNumber,
    currentMilestoneName
  );
  assertFeatureAvailableInMilestone(
    `conflictStrategy:${policy.conflictStrategy.mode}`,
    currentMilestoneNumber,
    currentMilestoneName
  );

  // 2. Resolve W, R, N
  const quorumNumbers = resolveQuorumNumbers(clusterSize, policy.writeAck, policy.readConsistency);

  return { policy, quorumNumbers };
}
