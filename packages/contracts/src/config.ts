export interface NodeConfig {
  readonly id: string;
  readonly clusterId: string;
  readonly dataDir: string;
  readonly grpcPort: number;
  readonly grpcHost?: string;
}

export interface ClusterConfig {
  readonly membershipVersion: number;
  readonly members: readonly string[];
}

export interface AppConfig {
  readonly node: NodeConfig;
  readonly cluster: ClusterConfig;
}

export function validateNodeConfig(node: Partial<NodeConfig>): NodeConfig {
  if (!node.id || typeof node.id !== 'string' || !node.id.trim()) {
    throw new Error('node.id is required and must be a non-empty string');
  }
  if (!node.clusterId || typeof node.clusterId !== 'string' || !node.clusterId.trim()) {
    throw new Error('node.clusterId is required and must be a non-empty string');
  }
  if (!node.dataDir || typeof node.dataDir !== 'string' || !node.dataDir.trim()) {
    throw new Error('node.dataDir is required and must be a non-empty string');
  }
  const port = node.grpcPort ?? 50051;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`node.grpcPort must be a valid port number (1-65535), got ${port}`);
  }

  return {
    id: node.id.trim(),
    clusterId: node.clusterId.trim(),
    dataDir: node.dataDir.trim(),
    grpcPort: port,
    grpcHost: node.grpcHost ?? '0.0.0.0'
  };
}

export function validateClusterConfig(cluster: Partial<ClusterConfig>, nodeId?: string): ClusterConfig {
  const version = cluster.membershipVersion ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`cluster.membershipVersion must be >= 1, got ${version}`);
  }
  const members = cluster.members ?? [];
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('cluster.members must be a non-empty array of node ids');
  }
  const trimmed = members.map((m) => {
    if (typeof m !== 'string' || !m.trim()) {
      throw new Error('Each cluster member must be a non-empty string');
    }
    return m.trim();
  });

  if (nodeId && !trimmed.includes(nodeId)) {
    throw new Error(`Current node ${nodeId} must be included in cluster.members`);
  }

  return {
    membershipVersion: version,
    members: Object.freeze([...new Set(trimmed)].sort())
  };
}
