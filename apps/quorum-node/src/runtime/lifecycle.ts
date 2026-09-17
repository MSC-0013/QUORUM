import {
  NodeLifecycleState,
  assertValidLifecycleTransition
} from '@quorum-lab/contracts';

export type LifecycleListener = (state: NodeLifecycleState, previousState: NodeLifecycleState) => void;

export class NodeLifecycle {
  private currentState: NodeLifecycleState = 'STARTING';
  private readonly listeners: Set<LifecycleListener> = new Set();

  public getState(): NodeLifecycleState {
    return this.currentState;
  }

  public isHealthy(): boolean {
    return this.currentState === 'HEALTHY';
  }

  public isServing(): boolean {
    return this.currentState === 'HEALTHY' || this.currentState === 'READY';
  }

  public transitionTo(newState: NodeLifecycleState): void {
    if (this.currentState === newState) return;

    assertValidLifecycleTransition(this.currentState, newState);
    const previous = this.currentState;
    this.currentState = newState;

    for (const listener of this.listeners) {
      try {
        listener(newState, previous);
      } catch (err) {
        console.error('Error in lifecycle listener:', err);
      }
    }
  }

  public onStateChange(listener: LifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
