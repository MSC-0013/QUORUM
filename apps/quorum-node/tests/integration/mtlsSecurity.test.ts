import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QuorumNodeApp } from '../../src/app.js';
import { PeerClientPool } from '@quorum-lab/replication';
import { generateTestTlsMaterial, TestTlsMaterial } from '../../../../packages/replication/tests/tlsHelper.js';

const TEST_TLS_DIR = path.resolve('./tests/tmp-mtls-certs');
const TEST_DATA_DIR = path.resolve('./tests/tmp-mtls-node');

describe('QuorumNode: Mutual TLS (mTLS) Inter-Node Security (§Q10)', () => {
  let tls: TestTlsMaterial;
  let serverApp: QuorumNodeApp;
  let serverPort: number;

  beforeAll(async () => {
    if (fs.existsSync(TEST_TLS_DIR)) {
      await fs.promises.rm(TEST_TLS_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_DATA_DIR)) {
      await fs.promises.rm(TEST_DATA_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(TEST_TLS_DIR, { recursive: true });
    await fs.promises.mkdir(TEST_DATA_DIR, { recursive: true });

    // Generate CA, server, valid client, and untrusted client certs
    tls = generateTestTlsMaterial(TEST_TLS_DIR);

    serverApp = new QuorumNodeApp(
      {
        node: {
          id: 'secure-node',
          clusterId: 'cluster-secure',
          dataDir: TEST_DATA_DIR,
          grpcPort: 0,
          grpcHost: '127.0.0.1'
        },
        cluster: {
          membershipVersion: 1,
          members: ['secure-node', 'client-peer']
        }
      },
      {
        tlsConfig: {
          caCert: tls.caCert,
          serverCert: tls.serverCert,
          serverKey: tls.serverKey,
          requireClientCert: true
        }
      }
    );

    serverPort = await serverApp.start();
  });

  afterAll(async () => {
    await serverApp.stop();
    if (fs.existsSync(TEST_TLS_DIR)) {
      await fs.promises.rm(TEST_TLS_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_DATA_DIR)) {
      await fs.promises.rm(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  it('allows replication requests from peer presenting valid client certificate signed by Cluster CA', async () => {
    const validPool = new PeerClientPool();
    validPool.registerPeer({
      nodeId: 'secure-node',
      address: `127.0.0.1:${serverPort}`,
      tls: {
        caCert: tls.caCert,
        clientCert: tls.clientCert,
        clientKey: tls.clientKey,
        serverNameOverride: 'localhost'
      }
    });

    const result = await validPool.replicateToPeer({
      peerNodeId: 'secure-node',
      sourceNodeId: 'client-peer',
      key: 'tls:key:1',
      entry: {
        value: Buffer.from('payload-over-mtls'),
        tombstone: false,
        version: {
          dot: { nodeId: 'client-peer', counter: 1 },
          vectorClock: { 'client-peer': 1 },
          lamport: 1,
          wallTimeMs: Date.now()
        }
      },
      operationId: 'op-mtls-1',
      requestId: 'req-mtls-1',
      membership: serverApp.runtime.getMembership()
    });

    expect(result.replicaAcked).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify written to storage
    const state = serverApp.engine.get({ key: 'tls:key:1' });
    expect(state.keyState.entries).toHaveLength(1);
    expect(Buffer.from(state.keyState.entries[0]!.value as Uint8Array).toString()).toBe('payload-over-mtls');

    await validPool.closeAll();
  });

  it('rejects connection when peer presents untrusted client certificate not signed by Cluster CA', async () => {
    const untrustedPool = new PeerClientPool();
    untrustedPool.registerPeer({
      nodeId: 'secure-node',
      address: `127.0.0.1:${serverPort}`,
      tls: {
        caCert: tls.caCert,
        clientCert: tls.untrustedCert,
        clientKey: tls.untrustedKey,
        serverNameOverride: 'localhost'
      }
    });

    const result = await untrustedPool.replicateToPeer({
      peerNodeId: 'secure-node',
      sourceNodeId: 'rogue-peer',
      key: 'tls:key:rogue',
      entry: {
        value: Buffer.from('rogue-data'),
        tombstone: false,
        version: {
          dot: { nodeId: 'rogue-peer', counter: 1 },
          vectorClock: { 'rogue-peer': 1 },
          lamport: 1,
          wallTimeMs: Date.now()
        }
      },
      operationId: 'op-mtls-rogue',
      requestId: 'req-mtls-rogue',
      membership: serverApp.runtime.getMembership()
    });

    expect(result.replicaAcked).toBe(false);
    expect(result.error).toBeDefined();

    await untrustedPool.closeAll();
  });

  it('rejects connection when peer attempts insecure plaintext connection without TLS', async () => {
    const insecurePool = new PeerClientPool();
    insecurePool.registerPeer({
      nodeId: 'secure-node',
      address: `127.0.0.1:${serverPort}`
      // No tls config -> plaintext insecure
    });

    const result = await insecurePool.replicateToPeer({
      peerNodeId: 'secure-node',
      sourceNodeId: 'insecure-peer',
      key: 'tls:key:insecure',
      entry: {
        value: Buffer.from('insecure-data'),
        tombstone: false,
        version: {
          dot: { nodeId: 'insecure-peer', counter: 1 },
          vectorClock: { 'insecure-peer': 1 },
          lamport: 1,
          wallTimeMs: Date.now()
        }
      },
      operationId: 'op-mtls-insecure',
      requestId: 'req-mtls-insecure',
      membership: serverApp.runtime.getMembership()
    });

    expect(result.replicaAcked).toBe(false);
    expect(result.error).toBeDefined();

    await insecurePool.closeAll();
  });
});
