import {
  AppConfig,
  validateNodeConfig,
  validateClusterConfig
} from '@quorum-lab/contracts';

export function loadConfigFromEnv(): AppConfig {
  const nodeId = process.env['QUORUM_NODE_ID'] ?? 'node-a';
  const clusterId = process.env['QUORUM_CLUSTER_ID'] ?? 'cluster-1';
  const dataDir = process.env['QUORUM_DATA_DIR'] ?? `./data/${nodeId}`;
  const grpcPort = parseInt(process.env['QUORUM_GRPC_PORT'] ?? '50051', 10);
  const grpcHost = process.env['QUORUM_GRPC_HOST'] ?? '0.0.0.0';

  const node = validateNodeConfig({
    id: nodeId,
    clusterId,
    dataDir,
    grpcPort,
    grpcHost
  });

  const rawMembers = process.env['QUORUM_CLUSTER_MEMBERS']
    ? process.env['QUORUM_CLUSTER_MEMBERS'].split(',').map((s) => s.trim())
    : [nodeId];

  const cluster = validateClusterConfig(
    {
      membershipVersion: parseInt(process.env['QUORUM_MEMBERSHIP_VERSION'] ?? '1', 10),
      members: rawMembers
    },
    node.id
  );

  return { node, cluster };
}
