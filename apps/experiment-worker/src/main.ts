import { ExperimentOrchestrator, ExperimentRunSpec } from './orchestrator.js';

async function main() {
  console.log('[EXPERIMENT-WORKER] Starting experiment worker...');
  const orchestrator = new ExperimentOrchestrator();

  // Can be called via CLI args or daemon mode
  if (process.argv.length > 2) {
    const rawSpec = process.argv[2];
    try {
      const spec = JSON.parse(rawSpec!) as ExperimentRunSpec;
      const report = await orchestrator.execute(spec);
      console.log('[EXPERIMENT-WORKER] Execution complete:', JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error('[EXPERIMENT-WORKER] Execution error:', err.message);
      process.exit(1);
    }
  } else {
    console.log('[EXPERIMENT-WORKER] Standing by for experiment execution requests.');
  }
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  main().catch((err) => {
    console.error('Fatal error in experiment worker:', err);
    process.exit(1);
  });
}
