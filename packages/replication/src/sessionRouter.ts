import { ClientSessionContext, VersionFrontier } from '@quorum-lab/consistency';

export interface SessionRouterMetrics {
  totalRoutedOperations: number;
  stickyHits: number;
  failovers: number;
}

export interface NodeHealthChecker {
  isNodeHealthy(nodeId: string): boolean;
}

export interface SessionRouterOptions {
  readonly clusterNodes?: readonly string[];
  readonly stickyAffinity?: boolean;
  readonly initialPreferredReplica?: string;
}

export class SessionRouter {
  private preferredReplicaId?: string;
  private readonly clusterNodes: readonly string[] = [];
  private readonly stickyAffinity: boolean = true;
  private readonly healthMap: Map<string, boolean> = new Map();
  private readonly sessionAffinityMap: Map<string, string> = new Map();

  private readonly metrics: SessionRouterMetrics = {
    totalRoutedOperations: 0,
    stickyHits: 0,
    failovers: 0
  };

  constructor(optionsOrInitial?: string | SessionRouterOptions) {
    if (typeof optionsOrInitial === 'string') {
      this.preferredReplicaId = optionsOrInitial;
    } else if (optionsOrInitial && typeof optionsOrInitial === 'object') {
      if (optionsOrInitial.clusterNodes) {
        this.clusterNodes = [...optionsOrInitial.clusterNodes];
      }
      if (optionsOrInitial.stickyAffinity !== undefined) {
        this.stickyAffinity = optionsOrInitial.stickyAffinity;
      }
      if (optionsOrInitial.initialPreferredReplica) {
        this.preferredReplicaId = optionsOrInitial.initialPreferredReplica;
      }
    }
  }

  public getPreferredReplica(): string | undefined {
    return this.preferredReplicaId;
  }

  public getMetrics(): SessionRouterMetrics {
    return { ...this.metrics };
  }

  public markReplicaHealth(nodeId: string, healthy: boolean): void {
    this.healthMap.set(nodeId, healthy);
  }

  public isReplicaHealthy(nodeId: string): boolean {
    return this.healthMap.get(nodeId) ?? true;
  }

  /**
   * Routes a client session to its assigned sticky replica, with health-aware failover.
   */
  public getReplicaForSession(sessionId: string): string {
    const nodes = this.clusterNodes.length > 0
      ? this.clusterNodes
      : (this.preferredReplicaId ? [this.preferredReplicaId] : []);

    if (nodes.length === 0) {
      throw new Error('No cluster nodes configured in SessionRouter');
    }

    if (this.stickyAffinity) {
      const assigned = this.sessionAffinityMap.get(sessionId);
      if (assigned && nodes.includes(assigned) && this.isReplicaHealthy(assigned)) {
        return assigned;
      }
    }

    const healthyNodes = nodes.filter((n) => this.isReplicaHealthy(n));
    const candidates = healthyNodes.length > 0 ? healthyNodes : nodes;

    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
    }
    const chosen = candidates[hash % candidates.length]!;

    if (this.stickyAffinity) {
      this.sessionAffinityMap.set(sessionId, chosen);
    }
    return chosen;
  }

  /**
   * Selects an appropriate replica node for the current operation according to sticky affinity and health.
   */
  public selectReplica(params: {
    availableNodeIds: readonly string[];
    healthChecker?: NodeHealthChecker;
  }): string {
    this.metrics.totalRoutedOperations += 1;

    // 1. If preferred replica is set, available, and healthy -> Sticky Hit
    if (this.preferredReplicaId && params.availableNodeIds.includes(this.preferredReplicaId)) {
      const healthy = params.healthChecker
        ? params.healthChecker.isNodeHealthy(this.preferredReplicaId)
        : this.isReplicaHealthy(this.preferredReplicaId);

      if (healthy) {
        this.metrics.stickyHits += 1;
        return this.preferredReplicaId;
      }
    }

    // 2. Preferred replica unavailable or unhealthy -> Failover to another available node
    const candidates = params.availableNodeIds.filter((nodeId) => {
      if (nodeId === this.preferredReplicaId) return false;
      return params.healthChecker
        ? params.healthChecker.isNodeHealthy(nodeId)
        : this.isReplicaHealthy(nodeId);
    });

    if (candidates.length === 0) {
      const fallback = params.availableNodeIds[0];
      if (!fallback) {
        throw new Error('No available replica nodes to route session operation');
      }
      this.preferredReplicaId = fallback;
      return fallback;
    }

    const nextPreferred = candidates[0]!;
    if (this.preferredReplicaId && this.preferredReplicaId !== nextPreferred) {
      this.metrics.failovers += 1;
    }
    this.preferredReplicaId = nextPreferred;
    return nextPreferred;
  }

  /**
   * Verifies that the candidate replica satisfies the session's monotonic frontier prior to reading.
   */
  public verifyMonotonicRead(
    session: ClientSessionContext,
    candidateReplicaFrontier: VersionFrontier
  ): boolean {
    return session.satisfiesSession(candidateReplicaFrontier);
  }
}
