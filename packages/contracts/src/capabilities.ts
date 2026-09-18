export type ReplicationEngineType = 'LEADERLESS' | 'LEADER' | 'RAFT';

export type ReadConsistencyMode =
  | 'ONE'
  | 'QUORUM'
  | 'ALL'
  | 'EVENTUAL'
  | 'SESSION'
  | 'CAUSAL';

export type WriteAckMode = 'ONE' | 'QUORUM' | 'ALL';

export type LocalDurabilityMode = 'MEMORY_ONLY' | 'BATCHED_FSYNC' | 'SYNC_FSYNC';

export type ConflictStrategyMode =
  | 'LAST_WRITE_WINS'
  | 'VERSION_VECTOR'
  | 'MULTI_VALUE'
  | 'CUSTOM_MERGE';

export interface MilestoneCapabilityRequirement {
  readonly featureName: string;
  readonly firstValidMilestone: string;
  readonly milestoneNumber: number;
}

/**
 * Capability availability matrix per §Q3 capability table.
 */
export const CAPABILITY_MILESTONES: Record<string, MilestoneCapabilityRequirement> = {
  // Replication Engines
  'replicationEngine:LEADERLESS': { featureName: 'LEADERLESS engine', firstValidMilestone: 'Q2', milestoneNumber: 2 },
  'replicationEngine:LEADER': { featureName: 'LEADER engine', firstValidMilestone: 'Q8', milestoneNumber: 8 },
  'replicationEngine:RAFT': { featureName: 'RAFT engine', firstValidMilestone: 'Q9', milestoneNumber: 9 },

  // Read Consistency
  'readConsistency:ONE': { featureName: 'ONE read consistency', firstValidMilestone: 'Q3', milestoneNumber: 3 },
  'readConsistency:QUORUM': { featureName: 'QUORUM read consistency', firstValidMilestone: 'Q3', milestoneNumber: 3 },
  'readConsistency:ALL': { featureName: 'ALL read consistency', firstValidMilestone: 'Q3', milestoneNumber: 3 },
  'readConsistency:EVENTUAL': { featureName: 'EVENTUAL read consistency', firstValidMilestone: 'Q3', milestoneNumber: 3 },
  'readConsistency:CAUSAL': { featureName: 'CAUSAL read consistency', firstValidMilestone: 'Q5', milestoneNumber: 5 },
  'readConsistency:SESSION': { featureName: 'SESSION read consistency', firstValidMilestone: 'Q7', milestoneNumber: 7 },

  // Write Ack Policies
  'writeAck:ONE': { featureName: 'ONE write ack policy', firstValidMilestone: 'Q3', milestoneNumber: 3 },
  'writeAck:QUORUM': { featureName: 'QUORUM write ack policy', firstValidMilestone: 'Q3', milestoneNumber: 3 },
  'writeAck:ALL': { featureName: 'ALL write ack policy', firstValidMilestone: 'Q3', milestoneNumber: 3 },

  // Local Durability Policies
  'localDurability:MEMORY_ONLY': { featureName: 'MEMORY_ONLY durability', firstValidMilestone: 'Q1', milestoneNumber: 1 },
  'localDurability:BATCHED_FSYNC': { featureName: 'BATCHED_FSYNC durability', firstValidMilestone: 'Q1', milestoneNumber: 1 },
  'localDurability:SYNC_FSYNC': { featureName: 'SYNC_FSYNC durability', firstValidMilestone: 'Q1', milestoneNumber: 1 },

  // Conflict Strategies
  'conflictStrategy:LAST_WRITE_WINS': { featureName: 'LAST_WRITE_WINS conflict strategy', firstValidMilestone: 'Q3', milestoneNumber: 3 },
  'conflictStrategy:VERSION_VECTOR': { featureName: 'VERSION_VECTOR conflict strategy', firstValidMilestone: 'Q5', milestoneNumber: 5 },
  'conflictStrategy:MULTI_VALUE': { featureName: 'MULTI_VALUE conflict strategy', firstValidMilestone: 'Q5', milestoneNumber: 5 },
  'conflictStrategy:CUSTOM_MERGE': { featureName: 'CUSTOM_MERGE conflict strategy', firstValidMilestone: 'Q5', milestoneNumber: 5 }
};

export class CapabilityMilestoneError extends Error {
  public readonly featureKey: string;
  public readonly firstValidMilestone: string;

  constructor(featureKey: string, requirement: MilestoneCapabilityRequirement, currentMilestone: string) {
    super(
      `FEATURE_NOT_AVAILABLE_IN_MILESTONE: ${requirement.featureName} requires ${requirement.firstValidMilestone}, but current milestone is ${currentMilestone}`
    );
    this.name = 'CapabilityMilestoneError';
    this.featureKey = featureKey;
    this.firstValidMilestone = requirement.firstValidMilestone;
  }
}

/**
 * Validates whether a feature is permitted under the given target milestone.
 * Default current milestone is 'Q3'.
 */
export function assertFeatureAvailableInMilestone(
  featureKey: string,
  currentMilestoneNumber = 11,
  currentMilestoneName = 'Q11'
): void {
  const requirement = CAPABILITY_MILESTONES[featureKey];
  if (!requirement) {
    throw new Error(`Unknown feature key: ${featureKey}`);
  }

  if (requirement.milestoneNumber > currentMilestoneNumber) {
    throw new CapabilityMilestoneError(featureKey, requirement, currentMilestoneName);
  }
}
