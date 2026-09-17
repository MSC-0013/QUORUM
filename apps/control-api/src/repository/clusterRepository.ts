import {
  ClusterPolicyConfig,
  ResolvedQuorumNumbers,
  createMembershipSnapshot
} from '@quorum-lab/contracts';

export interface ClusterRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly membershipVersion: number;
  readonly members: readonly string[];
  readonly membershipHash: string;
  readonly policy: ClusterPolicyConfig;
  readonly resolvedQuorum: ResolvedQuorumNumbers;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NodeRecord {
  readonly id: string;
  readonly clusterId: string;
  readonly grpcAddress: string;
  readonly status: 'UNKNOWN' | 'READY' | 'HEALTHY' | 'OFFLINE';
  readonly createdAt: string;
}

export class ClusterRepository {
  private readonly clusters = new Map<string, ClusterRecord>();
  private readonly nodes = new Map<string, Map<string, NodeRecord>>();

  public createCluster(params: {
    id?: string;
    projectId: string;
    name: string;
    members: readonly string[];
    policy: ClusterPolicyConfig;
    resolvedQuorum: ResolvedQuorumNumbers;
  }): ClusterRecord {
    const id = params.id ?? `cluster-${Math.random().toString(36).substring(2, 9)}`;
    if (this.clusters.has(id)) {
      throw new Error(`Cluster with ID ${id} already exists`);
    }

    const membership = createMembershipSnapshot(1, params.members);
    const now = new Date().toISOString();

    const record: ClusterRecord = {
      id,
      projectId: params.projectId,
      name: params.name,
      membershipVersion: membership.version,
      members: membership.members,
      membershipHash: membership.hash,
      policy: params.policy,
      resolvedQuorum: params.resolvedQuorum,
      createdAt: now,
      updatedAt: now
    };

    this.clusters.set(id, Object.freeze(record));
    this.nodes.set(id, new Map());

    return record;
  }

  public getCluster(id: string): ClusterRecord | undefined {
    return this.clusters.get(id);
  }

  public listClusters(projectId?: string): readonly ClusterRecord[] {
    const all = Array.from(this.clusters.values());
    if (projectId) {
      return all.filter((c) => c.projectId === projectId);
    }
    return all;
  }

  public addNode(params: {
    clusterId: string;
    nodeId: string;
    grpcAddress: string;
  }): NodeRecord {
    const cluster = this.clusters.get(params.clusterId);
    if (!cluster) {
      throw new Error(`Cluster ${params.clusterId} not found`);
    }

    let clusterNodeMap = this.nodes.get(params.clusterId);
    if (!clusterNodeMap) {
      clusterNodeMap = new Map();
      this.nodes.set(params.clusterId, clusterNodeMap);
    }

    const nodeRecord: NodeRecord = {
      id: params.nodeId,
      clusterId: params.clusterId,
      grpcAddress: params.grpcAddress,
      status: 'READY',
      createdAt: new Date().toISOString()
    };

    clusterNodeMap.set(params.nodeId, nodeRecord);
    return nodeRecord;
  }

  public listNodes(clusterId: string): readonly NodeRecord[] {
    const clusterNodeMap = this.nodes.get(clusterId);
    if (!clusterNodeMap) return [];
    return Array.from(clusterNodeMap.values());
  }

  public updatePolicy(
    clusterId: string,
    policy: ClusterPolicyConfig,
    resolvedQuorum: ResolvedQuorumNumbers
  ): ClusterRecord {
    const existing = this.clusters.get(clusterId);
    if (!existing) {
      throw new Error(`Cluster ${clusterId} not found`);
    }

    const updated: ClusterRecord = {
      ...existing,
      policy,
      resolvedQuorum,
      updatedAt: new Date().toISOString()
    };

    this.clusters.set(clusterId, Object.freeze(updated));
    return updated;
  }

  public clear(): void {
    this.clusters.clear();
    this.nodes.clear();
  }
}
