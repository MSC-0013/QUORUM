import { buildApp } from './app.js';
import { loadControlApiConfig } from './config.js';

async function start(): Promise<void> {
  const config = loadControlApiConfig();
  const app = buildApp();

  try {
    const address = await app.listen({ port: config.port, host: config.host });
    console.log(`[CONTROL API] Server listening on ${address}`);
  } catch (err) {
    console.error('Error starting control API:', err);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts')) {
  start().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}

export { start };
