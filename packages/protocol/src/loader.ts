import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as protoLoader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROTO_DIR = path.resolve(__dirname, '../proto');

export function loadProtoDefinition(filename: string): grpc.GrpcObject {
  const protoPath = path.join(PROTO_DIR, filename);
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR]
  });
  return grpc.loadPackageDefinition(packageDefinition);
}

export function getNodeServiceDefinition(): grpc.ServiceDefinition {
  const protoPath = path.join(PROTO_DIR, 'node.proto');
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR]
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    quorum: {
      node: {
        v1: {
          NodeService: {
            service: grpc.ServiceDefinition;
          };
        };
      };
    };
  };
  return loaded.quorum.node.v1.NodeService.service;
}

export function getHealthServiceDefinition(): grpc.ServiceDefinition {
  const protoPath = path.join(PROTO_DIR, 'health.proto');
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR]
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    grpc: {
      health: {
        v1: {
          Health: {
            service: grpc.ServiceDefinition;
          };
        };
      };
    };
  };
  return loaded.grpc.health.v1.Health.service;
}
