import * as grpc from '@grpc/grpc-js';
import { NodeEngine } from '../engine/nodeEngine.js';
import { ProtoStatusCode } from '@quorum-lab/protocol';

export class NodeServiceImpl {
  private readonly engine: NodeEngine;

  constructor(engine: NodeEngine) {
    this.engine = engine;
  }

  public put = (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const { key, value, run_id, client_id, operation_id, request_id } = call.request;

      if (!key || typeof key !== 'string') {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Key is required and must be a non-empty string'
        });
        return;
      }

      const valBuffer = Buffer.isBuffer(value)
        ? value
        : value instanceof Uint8Array
          ? Buffer.from(value)
          : Buffer.from(String(value ?? ''));

      const result = this.engine.put({
        key,
        value: valBuffer,
        runId: run_id ?? '',
        clientId: client_id ?? '',
        operationId: operation_id ?? '',
        requestId: request_id ?? ''
      });

      callback(null, {
        status: {
          code: ProtoStatusCode.STATUS_CODE_OK,
          message: 'OK'
        },
        version: {
          dot: {
            node_id: result.version.dot.nodeId,
            counter: result.version.dot.counter
          },
          vector_clock: {
            entries: result.version.vectorClock
          },
          lamport: result.version.lamport,
          wall_time_ms: result.version.wallTimeMs
        },
        resulting_frontier: {
          maximal_versions: result.frontier.maximalVersions.map((v) => ({
            dot: { node_id: v.dot.nodeId, counter: v.dot.counter },
            vector_clock: { entries: v.vectorClock },
            lamport: v.lamport,
            wall_time_ms: v.wallTimeMs
          }))
        }
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during Put'
      });
    }
  };

  public get = (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const { key } = call.request;
      if (!key || typeof key !== 'string') {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Key is required and must be a non-empty string'
        });
        return;
      }

      const result = this.engine.get({ key });

      callback(null, {
        status: {
          code: ProtoStatusCode.STATUS_CODE_OK,
          message: 'OK'
        },
        key_state: {
          key: result.keyState.key,
          entries: result.keyState.entries.map((e) => ({
            value: e.value ? Buffer.from(e.value) : Buffer.alloc(0),
            tombstone: e.tombstone,
            version: {
              dot: { node_id: e.version.dot.nodeId, counter: e.version.dot.counter },
              vector_clock: { entries: e.version.vectorClock },
              lamport: e.version.lamport,
              wall_time_ms: e.version.wallTimeMs
            }
          }))
        },
        frontier: {
          maximal_versions: result.frontier.maximalVersions.map((v) => ({
            dot: { node_id: v.dot.nodeId, counter: v.dot.counter },
            vector_clock: { entries: v.vectorClock },
            lamport: v.lamport,
            wall_time_ms: v.wallTimeMs
          }))
        }
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during Get'
      });
    }
  };

  public delete = (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const { key, run_id, client_id, operation_id, request_id } = call.request;
      if (!key || typeof key !== 'string') {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Key is required and must be a non-empty string'
        });
        return;
      }

      const result = this.engine.delete({
        key,
        runId: run_id ?? '',
        clientId: client_id ?? '',
        operationId: operation_id ?? '',
        requestId: request_id ?? ''
      });

      callback(null, {
        status: {
          code: ProtoStatusCode.STATUS_CODE_OK,
          message: 'OK'
        },
        tombstone_version: {
          dot: {
            node_id: result.tombstoneVersion.dot.nodeId,
            counter: result.tombstoneVersion.dot.counter
          },
          vector_clock: {
            entries: result.tombstoneVersion.vectorClock
          },
          lamport: result.tombstoneVersion.lamport,
          wall_time_ms: result.tombstoneVersion.wallTimeMs
        },
        resulting_frontier: {
          maximal_versions: result.frontier.maximalVersions.map((v) => ({
            dot: { node_id: v.dot.nodeId, counter: v.dot.counter },
            vector_clock: { entries: v.vectorClock },
            lamport: v.lamport,
            wall_time_ms: v.wallTimeMs
          }))
        }
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during Delete'
      });
    }
  };

  public getVersions = (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const { key } = call.request;
      if (!key || typeof key !== 'string') {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Key is required and must be a non-empty string'
        });
        return;
      }

      const frontier = this.engine.getVersions(key);

      callback(null, {
        maximal_versions: frontier.maximalVersions.map((v) => ({
          dot: { node_id: v.dot.nodeId, counter: v.dot.counter },
          vector_clock: { entries: v.vectorClock },
          lamport: v.lamport,
          wall_time_ms: v.wallTimeMs
        }))
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during GetVersions'
      });
    }
  };

  public getNodeState = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const state = this.engine.getNodeState();
      callback(null, {
        node_id: state.nodeId,
        cluster_id: state.clusterId,
        lifecycle_state: state.lifecycleState,
        membership: {
          version: state.membership.version,
          members: state.membership.members,
          hash: state.membership.hash
        },
        key_count: state.keyCount,
        lamport: state.lamport,
        wall_time_ms: state.wallTimeMs
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during GetNodeState'
      });
    }
  };

  // The following RPCs are deliberately UNIMPLEMENTED in Q0 per §Q0 / §14
  public createSnapshot = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: 'CreateSnapshot is not implemented in Milestone Q0 (scheduled for Q1)'
    });
  };

  public replicate = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: 'Replicate is not implemented in Milestone Q0 (scheduled for Q2)'
    });
  };

  public readDigest = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: 'ReadDigest is not implemented in Milestone Q0 (scheduled for Q6)'
    });
  };

  public repair = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: 'Repair is not implemented in Milestone Q0 (scheduled for Q6)'
    });
  };

  public prepareWrite = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: 'PrepareWrite is not implemented in Milestone Q0 (scheduled for Q8)'
    });
  };

  public commitWrite = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: 'CommitWrite is not implemented in Milestone Q0 (scheduled for Q8)'
    });
  };

  public getServiceImplementation(): grpc.UntypedServiceImplementation {
    return {
      Put: this.put,
      Get: this.get,
      Delete: this.delete,
      GetVersions: this.getVersions,
      GetNodeState: this.getNodeState,
      CreateSnapshot: this.createSnapshot,
      Replicate: this.replicate,
      ReadDigest: this.readDigest,
      Repair: this.repair,
      PrepareWrite: this.prepareWrite,
      CommitWrite: this.commitWrite
    };
  }
}
