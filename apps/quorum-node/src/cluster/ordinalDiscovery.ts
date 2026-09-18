import { AppConfig } from '@quorum-lab/contracts';
import { PeerEndpoint } from '@quorum-lab/replication';

export interface PodOrdinalInfo {
  readonly ordinal: number;
  readonly nodeId: string;
  readonly podName: string;
}

/**
 * Extracts ordinal and node ID from Kubernetes StatefulSet pod hostname.
 * Standard format: "<statefulset-name>-<ordinal>", e.g. "quorum-node-0".
 */
export function parsePodOrdinal(podName: string, basePrefix = 'quorum-node'): PodOrdinalInfo {
  const regex = new RegExp(`^${basePrefix}-(\\d+)$`);
  const match = podName.match(regex);
  if (!match || match[1] === undefined) {
    // Fallback for non-statefulset or custom hostname
    return {
      ordinal: 0,
      nodeId: podName,
      podName
    };
  }

  const ordinal = parseInt(match[1], 10);
  return {
    ordinal,
    nodeId: `${basePrefix}-${ordinal}`,
    podName
  };
}

/**
 * Generates stable headless peer endpoints for all members of the StatefulSet.
 */
export function generateHeadlessPeerEndpoints(
  headlessService: string,
  clusterSize: number,
  port = 50051,
  basePrefix = 'quorum-node'
): PeerEndpoint[] {
  const endpoints: PeerEndpoint[] = [];
  for (let i = 0; i < clusterSize; i++) {
    const nodeId = `${basePrefix}-${i}`;
    const address = `${nodeId}.${headlessService}:${port}`;
    endpoints.push({ nodeId, address });
  }
  return endpoints;
}

/**
 * Automatically synthesizes cluster and node configuration in Kubernetes StatefulSets.
 */
export function buildStatefulSetAppConfig(params: {
  podName: string;
  headlessService: string;
  clusterSize: number;
  dataDir: string;
  grpcPort?: number;
  grpcHost?: string;
  basePrefix?: string;
  clusterId?: string;
}): { config: AppConfig; peerEndpoints: PeerEndpoint[] } {
  const basePrefix = params.basePrefix ?? 'quorum-node';
  const { nodeId } = parsePodOrdinal(params.podName, basePrefix);
  const port = params.grpcPort ?? 50051;
  const allEndpoints = generateHeadlessPeerEndpoints(params.headlessService, params.clusterSize, port, basePrefix);
  const memberIds = allEndpoints.map((e) => e.nodeId);

  const config: AppConfig = {
    node: {
      id: nodeId,
      clusterId: params.clusterId ?? 'quorum-k8s-cluster',
      dataDir: params.dataDir,
      grpcPort: port,
      grpcHost: params.grpcHost ?? '0.0.0.0'
    },
    cluster: {
      membershipVersion: 1,
      members: memberIds
    }
  };

  const peerEndpoints = allEndpoints.filter((e) => e.nodeId !== nodeId);

  return { config, peerEndpoints };
}
