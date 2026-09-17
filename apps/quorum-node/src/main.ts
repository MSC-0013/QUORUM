import { loadConfigFromEnv } from './config.js';
import { QuorumNodeApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const app = new QuorumNodeApp(config);

  process.on('SIGINT', async () => {
    console.log(`\nReceived SIGINT. Shutting down ${config.node.id}...`);
    await app.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log(`\nReceived SIGTERM. Shutting down ${config.node.id}...`);
    await app.stop();
    process.exit(0);
  });

  try {
    const port = await app.start();
    console.log(
      `[QUORUM LAB] Node ${config.node.id} listening on 0.0.0.0:${port} (Cluster: ${config.node.clusterId}, State: ${app.lifecycle.getState()})`
    );
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
