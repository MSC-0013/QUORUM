import { TimelineEvent, ExperimentTimeline } from '@quorum-lab/fault-model';

export interface NodeFaultClients {
  readonly [nodeId: string]: any;
}

export class TimelineRunner {
  private readonly timeline: ExperimentTimeline;
  private readonly clients: NodeFaultClients;

  constructor(events: readonly TimelineEvent[], clients: NodeFaultClients) {
    this.timeline = new ExperimentTimeline(events);
    this.clients = clients;
  }

  public async run(): Promise<void> {
    const events = this.timeline.getEvents();
    if (events.length === 0) return;

    const start = Date.now();

    for (const ev of events) {
      const targetTime = start + ev.offsetMs;
      const waitTime = targetTime - Date.now();
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const targetNodeId = ev.rule?.targetNodeId;
      const client = targetNodeId ? this.clients[targetNodeId] : null;

      if (ev.action === 'SET_FAULT' && ev.rule) {
        if (client) {
          await new Promise<void>((resolve) => {
            client.SetFault({ rule: ev.rule }, () => resolve());
          });
        }
      } else if (ev.action === 'CLEAR_FAULT' && ev.faultId) {
        if (client) {
          await new Promise<void>((resolve) => {
            client.ClearFault({ fault_id: ev.faultId }, () => resolve());
          });
        }
      }
    }
  }

  public async cleanup(): Promise<void> {
    for (const client of Object.values(this.clients)) {
      await new Promise<void>((resolve) => {
        client.ClearAllFaults({}, () => resolve());
      });
    }
  }
}
