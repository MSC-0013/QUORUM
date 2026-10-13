import { ConsistencyChecker } from './checker.js';
import { RecordedOperation } from './types.js';

async function main() {
  console.log('[ANALYSIS-WORKER] Starting analysis worker...');

  if (process.argv.length > 2) {
    const rawOps = process.argv[2];
    try {
      const ops = JSON.parse(rawOps!) as RecordedOperation[];
      const summary = ConsistencyChecker.analyzeHistory(ops);
      console.log('[ANALYSIS-WORKER] Analysis summary:', JSON.stringify(summary, null, 2));
    } catch (err: any) {
      console.error('[ANALYSIS-WORKER] Analysis error:', err.message);
      process.exit(1);
    }
  } else {
    console.log('[ANALYSIS-WORKER] Analysis worker running in standby daemon mode.');
  }
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  main().catch((err) => {
    console.error('Fatal error in analysis worker:', err);
    process.exit(1);
  });
}

export { main };
