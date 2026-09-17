import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { PROTO_DIR } from '@quorum-lab/protocol';

let NodeServiceConstructor: any = null;
let FaultControlServiceConstructor: any = null;

function loadConstructors() {
  if (!NodeServiceConstructor) {
    const nodePkg = protoLoader.loadSync(path.join(PROTO_DIR, 'node.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR]
    });
    const loadedNode = grpc.loadPackageDefinition(nodePkg) as any;
    NodeServiceConstructor = loadedNode.quorum.node.v1.NodeService;
  }

  if (!FaultControlServiceConstructor) {
    const faultPkg = protoLoader.loadSync(path.join(PROTO_DIR, 'fault.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR]
    });
    const loadedFault = grpc.loadPackageDefinition(faultPkg) as any;
    FaultControlServiceConstructor = loadedFault.quorum.fault.v1.FaultControlService;
  }
}

export function createNodeClient(address: string): any {
  loadConstructors();
  return new NodeServiceConstructor(address, grpc.credentials.createInsecure());
}

export function createFaultClient(address: string): any {
  loadConstructors();
  return new FaultControlServiceConstructor(address, grpc.credentials.createInsecure());
}
