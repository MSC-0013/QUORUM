import http from 'node:http';
import { loadConfigFromEnv } from './config.js';
import { QuorumNodeApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const app = new QuorumNodeApp(config);

  const httpPort = parseInt(process.env['PORT'] ?? process.env['HTTP_PORT'] ?? '8080', 10);
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'QUORUM LAB Distributed Consensus Cluster Node',
        status: 'ONLINE',
        nodeId: config.node.id,
        clusterId: config.node.clusterId,
        state: app.lifecycle.getState(),
        grpcPort: config.node.port,
        httpPort,
        replication: 'Leaderless Dynamo-style (W=2, R=2, N=3)',
        durability: 'WAL fsync + MemStore',
        conflictResolution: 'Last-Write-Wins (Vector Clocks + Dot)'
      })
    );
  });

  process.on('SIGINT', async () => {
    console.log(`\nReceived SIGINT. Shutting down ${config.node.id}...`);
    httpServer.close();
    await app.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log(`\nReceived SIGTERM. Shutting down ${config.node.id}...`);
    httpServer.close();
    await app.stop();
    process.exit(0);
  });

  try {
    const port = await app.start();
    console.log(
      `[QUORUM LAB] Node ${config.node.id} listening on 0.0.0.0:${port} (Cluster: ${config.node.clusterId}, State: ${app.lifecycle.getState()})`
    );

    httpServer.listen(httpPort, '0.0.0.0', () => {
      console.log(`[QUORUM LAB] Public HTTP health server listening on 0.0.0.0:${httpPort}`);
    });
  } catch (err) {
    console.error('Failed to start Quorum Node:', err);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts')) {
  main().catch((err) => {
    console.error('Unhandled bootstrap rejection:', err);
    process.exit(1);
  });
}

export { main };
