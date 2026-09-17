export type NodeLifecycleState =
  | 'STARTING'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'STOPPING'
  | 'TERMINATED';

const VALID_TRANSITIONS: Readonly<Record<NodeLifecycleState, readonly NodeLifecycleState[]>> = {
  STARTING: ['BOOTSTRAPPING', 'STOPPING', 'TERMINATED'],
  BOOTSTRAPPING: ['READY', 'DEGRADED', 'STOPPING', 'TERMINATED'],
  READY: ['HEALTHY', 'DEGRADED', 'STOPPING', 'TERMINATED'],
  HEALTHY: ['DEGRADED', 'STOPPING', 'TERMINATED'],
  DEGRADED: ['READY', 'HEALTHY', 'STOPPING', 'TERMINATED'],
  STOPPING: ['TERMINATED'],
  TERMINATED: []
};

export function isValidLifecycleTransition(
  from: NodeLifecycleState,
  to: NodeLifecycleState
): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertValidLifecycleTransition(
  from: NodeLifecycleState,
  to: NodeLifecycleState
): void {
  if (!isValidLifecycleTransition(from, to)) {
    throw new Error(`Invalid node lifecycle transition from ${from} to ${to}`);
  }
}
