import * as grpc from '@grpc/grpc-js';
import { AppConfig, createMembershipSnapshot } from '@quorum-lab/contracts';
import {
  getNodeServiceDefinition,
  getHealthServiceDefinition,
  getFaultControlServiceDefinition
} from '@quorum-lab/protocol';
import { StorageEngine } from '@quorum-lab/storage';
import { FaultRegistry } from '@quorum-lab/fault-model';
import { DefaultNodeClocks } from './runtime/clocks.js';
import { NodeLifecycle } from './runtime/lifecycle.js';
import { DefaultNodeRuntimeState } from './runtime/nodeState.js';
import { MemStore } from './engine/memStore.js';
import { NodeEngine } from './engine/nodeEngine.js';
import { NodeServiceImpl } from './service/nodeServiceImpl.js';
import { HealthServiceImpl } from './service/healthServiceImpl.js';
import { FaultControlServiceImpl } from './service/faultControlServiceImpl.js';

import { LocalDurabilityMode } from '@quorum-lab/storage';
import { ReplicationMode } from './engine/nodeEngine.js';
import { QuorumConfig } from '@quorum-lab/replication';

export interface QuorumNodeAppOptions {
  durabilityMode?: LocalDurabilityMode;
  replicationMode?: ReplicationMode;
  quorumConfig?: QuorumConfig;
  leaderConfig?: {
    initialLeaderId?: string;
    initialEpoch?: number;
    leaseDurationMs?: number;
  };
}

export class QuorumNodeApp {
  public readonly config: AppConfig;
  public readonly lifecycle: NodeLifecycle;
  public readonly clocks: DefaultNodeClocks;
  public readonly runtime: DefaultNodeRuntimeState;
  public readonly store: MemStore;
  public readonly storage: StorageEngine;
  public readonly engine: NodeEngine;
  public readonly faultRegistry: FaultRegistry;
  private readonly server: grpc.Server;
  private boundPort = 0;

  constructor(config: AppConfig, options?: QuorumNodeAppOptions) {
    this.config = config;
    this.lifecycle = new NodeLifecycle();
    this.clocks = new DefaultNodeClocks(config.node.id);
    this.faultRegistry = new FaultRegistry();

    const membership = createMembershipSnapshot(
      config.cluster.membershipVersion,
      config.cluster.members
    );

    this.runtime = new DefaultNodeRuntimeState({
      nodeId: config.node.id,
      clusterId: config.node.clusterId,
      membership,
      clocks: this.clocks,
      lifecycle: this.lifecycle
    });

    this.store = new MemStore();
    this.storage = new StorageEngine({
      dataDir: config.node.dataDir,
      durabilityMode: options?.durabilityMode ?? 'SYNC_FSYNC'
    });
    this.engine = new NodeEngine(
      this.runtime,
      this.storage,
      this.store,
      options?.replicationMode ?? 'NONE',
      options?.quorumConfig,
      options?.leaderConfig
    );

    // Wire network fault interceptor into peer client pool
    this.engine.peerPool.setFaultInterceptor((ctx) => {
      const decision = this.faultRegistry.evaluate({
        scope: 'NODE_TO_NODE',
        localNodeId: ctx.sourceNodeId,
        peerNodeId: ctx.peerNodeId
      });
      return {
        allow: decision.allow,
        delayMs: decision.delayMs,
        drop: decision.drop,
        error: decision.injectError
      };
    });

    this.server = new grpc.Server();

    this.registerServices();
  }

  private registerServices(): void {
    const nodeServiceDef = getNodeServiceDefinition();
    const nodeServiceImpl = new NodeServiceImpl(this.engine);
    this.server.addService(nodeServiceDef, nodeServiceImpl.getServiceImplementation());

    const healthServiceDef = getHealthServiceDefinition();
    const healthServiceImpl = new HealthServiceImpl(this.lifecycle);
    this.server.addService(healthServiceDef, healthServiceImpl.getServiceImplementation());

    const faultServiceDef = getFaultControlServiceDefinition();
    const faultServiceImpl = new FaultControlServiceImpl(
      this.config.node.id,
      this.faultRegistry,
      this.lifecycle,
      this.clocks
    );
    this.server.addService(faultServiceDef, faultServiceImpl.getServiceImplementation());
  }

  public async start(): Promise<number> {
    this.lifecycle.transitionTo('BOOTSTRAPPING');

    // 1. Recover state from snapshot and WAL
    await this.engine.recover();

    const address = `${this.config.node.grpcHost ?? '0.0.0.0'}:${this.config.node.grpcPort}`;

    return new Promise<number>((resolve, reject) => {
      this.server.bindAsync(
        address,
        grpc.ServerCredentials.createInsecure(),
        (error, port) => {
          if (error) {
            this.lifecycle.transitionTo('DEGRADED');
            reject(error);
            return;
          }

          this.boundPort = port;

          this.lifecycle.transitionTo('READY');
          this.lifecycle.transitionTo('HEALTHY');

          resolve(port);
        }
      );
    });
  }

  public async stop(): Promise<void> {
    if (this.lifecycle.getState() === 'TERMINATED') return;

    this.lifecycle.transitionTo('STOPPING');

    await this.engine.close();

    return new Promise<void>((resolve) => {
      this.server.tryShutdown((err) => {
        if (err) {
          this.server.forceShutdown();
        }
        this.lifecycle.transitionTo('TERMINATED');
        resolve();
      });
    });
  }

  public getBoundPort(): number {
    return this.boundPort;
  }
}
