import * as grpc from '@grpc/grpc-js';
import { NodeLifecycle } from '../runtime/lifecycle.js';
import { HealthCheckServingStatus } from '@quorum-lab/protocol';

export class HealthServiceImpl {
  private readonly lifecycle: NodeLifecycle;

  constructor(lifecycle: NodeLifecycle) {
    this.lifecycle = lifecycle;
  }

  public check = (
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    const isServing = this.lifecycle.isServing();
    const status = isServing
      ? HealthCheckServingStatus.SERVING
      : HealthCheckServingStatus.NOT_SERVING;

    callback(null, { status });
  };

  public watch = (call: grpc.ServerWritableStream<any, any>): void => {
    // Send current status immediately
    const sendStatus = () => {
      const isServing = this.lifecycle.isServing();
      const status = isServing
        ? HealthCheckServingStatus.SERVING
        : HealthCheckServingStatus.NOT_SERVING;

      call.write({ status });
    };

    sendStatus();

    // Subscribe to lifecycle changes
    const unsubscribe = this.lifecycle.onStateChange(() => {
      sendStatus();
    });

    call.on('cancelled', () => {
      unsubscribe();
    });

    call.on('end', () => {
      unsubscribe();
      call.end();
    });
  };

  public getServiceImplementation(): grpc.UntypedServiceImplementation {
    return {
      Check: this.check,
      Watch: this.watch
    };
  }
}
