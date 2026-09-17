import { describe, it, expect } from 'vitest';
import {
  getNodeServiceDefinition,
  getHealthServiceDefinition,
  PROTO_DIR
} from '../src/index.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Protocol: Proto Definitions & Loader', () => {
  it('confirms proto directory contains all required protocol contracts', () => {
    expect(fs.existsSync(path.join(PROTO_DIR, 'common.proto'))).toBe(true);
    expect(fs.existsSync(path.join(PROTO_DIR, 'node.proto'))).toBe(true);
    expect(fs.existsSync(path.join(PROTO_DIR, 'fault.proto'))).toBe(true);
    expect(fs.existsSync(path.join(PROTO_DIR, 'raft.proto'))).toBe(true);
    expect(fs.existsSync(path.join(PROTO_DIR, 'events.proto'))).toBe(true);
    expect(fs.existsSync(path.join(PROTO_DIR, 'health.proto'))).toBe(true);
  });

  it('loads NodeService gRPC service definition', () => {
    const nodeDef = getNodeServiceDefinition();
    expect(nodeDef).toBeDefined();
    expect(nodeDef['Put']).toBeDefined();
    expect(nodeDef['Get']).toBeDefined();
    expect(nodeDef['Delete']).toBeDefined();
    expect(nodeDef['GetVersions']).toBeDefined();
    expect(nodeDef['GetNodeState']).toBeDefined();
    expect(nodeDef['CreateSnapshot']).toBeDefined();
    expect(nodeDef['Replicate']).toBeDefined();
    expect(nodeDef['ReadDigest']).toBeDefined();
    expect(nodeDef['Repair']).toBeDefined();
    expect(nodeDef['PrepareWrite']).toBeDefined();
    expect(nodeDef['CommitWrite']).toBeDefined();
  });

  it('loads Health gRPC service definition', () => {
    const healthDef = getHealthServiceDefinition();
    expect(healthDef).toBeDefined();
    expect(healthDef['Check']).toBeDefined();
    expect(healthDef['Watch']).toBeDefined();
  });
});
