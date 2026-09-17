import { MembershipSnapshot } from '@quorum-lab/contracts';
import { NodeLifecycle } from './lifecycle.js';
import { NodeClocks } from './clocks.js';

export interface NodeRuntimeState {
  readonly nodeId: string;
  readonly clusterId: string;
  readonly lifecycle: NodeLifecycle;
  readonly clocks: NodeClocks;
  getMembership(): MembershipSnapshot;
  updateMembership(newSnapshot: MembershipSnapshot): void;
}

export class DefaultNodeRuntimeState implements NodeRuntimeState {
  public readonly nodeId: string;
  public readonly clusterId: string;
  public readonly lifecycle: NodeLifecycle;
  public readonly clocks: NodeClocks;
  private membership: MembershipSnapshot;

  constructor(params: {
    nodeId: string;
    clusterId: string;
    membership: MembershipSnapshot;
    clocks: NodeClocks;
    lifecycle?: NodeLifecycle;
  }) {
    this.nodeId = params.nodeId;
    this.clusterId = params.clusterId;
    this.membership = params.membership;
    this.clocks = params.clocks;
    this.lifecycle = params.lifecycle ?? new NodeLifecycle();
  }

  public getMembership(): MembershipSnapshot {
    return this.membership;
  }

  public updateMembership(newSnapshot: MembershipSnapshot): void {
    if (newSnapshot.version < this.membership.version) {
      throw new Error(
        `Cannot downgrade membership version from ${this.membership.version} to ${newSnapshot.version}`
      );
    }
    this.membership = newSnapshot;
  }
}
