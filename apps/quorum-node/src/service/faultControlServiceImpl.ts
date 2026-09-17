import * as grpc from '@grpc/grpc-js';
import { ProtoStatusCode } from '@quorum-lab/protocol';
import { FaultRegistry, FaultRule, FaultType, FaultScope } from '@quorum-lab/fault-model';
import { NodeLifecycle } from '../runtime/lifecycle.js';
import { DefaultNodeClocks } from '../runtime/clocks.js';

export class FaultControlServiceImpl {
  private readonly faultRegistry: FaultRegistry;
  private readonly lifecycle: NodeLifecycle;
  private readonly clocks: DefaultNodeClocks;
  private readonly nodeId: string;

  constructor(
    nodeId: string,
    faultRegistry: FaultRegistry,
    lifecycle: NodeLifecycle,
    clocks: DefaultNodeClocks
  ) {
    this.nodeId = nodeId;
    this.faultRegistry = faultRegistry;
    this.lifecycle = lifecycle;
    this.clocks = clocks;
  }

  private parseFaultType(rawType: any): FaultType {
    if (typeof rawType === 'string') {
      const cleaned = rawType.replace(/^FAULT_TYPE_/, '');
      return cleaned as FaultType;
    }
    const map: Record<number, FaultType> = {
      1: 'DELAY',
      2: 'LOSS',
      3: 'DUPLICATION',
      4: 'REORDER',
      5: 'PARTITION',
      6: 'CLOCK_SKEW',
      7: 'SLOW_DISK',
      8: 'WRITE_FAILURE',
      9: 'READ_FAILURE'
    };
    return map[rawType] ?? 'DELAY';
  }

  private parseFaultScope(rawScope: any): FaultScope {
    if (typeof rawScope === 'string') {
      const cleaned = rawScope.replace(/^FAULT_SCOPE_/, '');
      return cleaned as FaultScope;
    }
    const map: Record<number, FaultScope> = {
      1: 'NODE_TO_NODE',
      2: 'CLIENT_TO_NODE',
      3: 'PROCESS',
      4: 'STORAGE',
      5: 'CLOCK'
    };
    return map[rawScope] ?? 'NODE_TO_NODE';
  }

  public setFault = (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const rawRule = call.request?.rule;
      if (!rawRule) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'FaultRule is required'
        });
        return;
      }

      const faultId = rawRule.fault_id || `fault-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const rule: FaultRule = {
        faultId,
        type: this.parseFaultType(rawRule.fault_type),
        scope: this.parseFaultScope(rawRule.scope),
        targetNodeId: rawRule.target_node_id || this.nodeId,
        peerNodeId: rawRule.peer_node_id || undefined,
        delayMs: Number(rawRule.delay_ms) || undefined,
        probability: rawRule.probability !== undefined ? Number(rawRule.probability) : undefined,
        clockSkewMs: rawRule.clock_skew_ms !== undefined ? Number(rawRule.clock_skew_ms) : undefined,
        durationMs: rawRule.duration_ms !== undefined ? Number(rawRule.duration_ms) : undefined,
        createdAt: new Date().toISOString()
      };

      this.faultRegistry.setRule(rule);

      // Handle direct clock skew side-effect
      if (rule.type === 'CLOCK_SKEW' && rule.scope === 'CLOCK') {
        this.clocks.wall.setSkewOffsetMs(rule.clockSkewMs ?? 0);
      }

      callback(null, {
        status: {
          code: ProtoStatusCode.STATUS_CODE_OK,
          message: 'Fault rule configured successfully'
        },
        fault_id: faultId
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err.message
      });
    }
  };

  public clearFault = (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const faultId = call.request?.fault_id;
      if (!faultId) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'fault_id is required'
        });
        return;
      }

      const rule = this.faultRegistry.getRule(faultId);
      this.faultRegistry.clearRule(faultId);

      if (rule && rule.type === 'CLOCK_SKEW' && rule.scope === 'CLOCK') {
        const remainingSkew = this.faultRegistry.getActiveClockSkewMs(this.nodeId);
        this.clocks.wall.setSkewOffsetMs(remainingSkew);
      }

      callback(null, {
        status: {
          code: ProtoStatusCode.STATUS_CODE_OK,
          message: 'Fault rule cleared'
        }
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err.message
      });
    }
  };

  public clearAllFaults = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const clearedCount = this.faultRegistry.clearAll();
      this.clocks.wall.setSkewOffsetMs(0);

      callback(null, {
        status: {
          code: ProtoStatusCode.STATUS_CODE_OK,
          message: 'All faults cleared'
        },
        cleared_count: clearedCount
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err.message
      });
    }
  };

  public crash = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      this.lifecycle.transitionTo('TERMINATED');

      callback(null, {
        status: {
          code: ProtoStatusCode.STATUS_CODE_OK,
          message: 'Node simulated crash executed'
        }
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err.message
      });
    }
  };

  public getServiceImplementation(): grpc.UntypedServiceImplementation {
    return {
      SetFault: this.setFault,
      ClearFault: this.clearFault,
      ClearAllFaults: this.clearAllFaults,
      Crash: this.crash
    };
  }
}
