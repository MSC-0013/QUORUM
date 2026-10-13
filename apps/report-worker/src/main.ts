import { ReportGenerator } from './reportGenerator.js';

async function main() {
  console.log('[REPORT-WORKER] Starting report worker...');
  if (process.argv.length > 2) {
    try {
      const payload = JSON.parse(process.argv[2]!);
      const report = ReportGenerator.generateReport(
        payload.runId,
        payload.durationMs,
        payload.latencies,
        payload.analysis
      );
      console.log('[REPORT-WORKER] Generated report:', JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error('[REPORT-WORKER] Report generation error:', err.message);
      process.exit(1);
    }
  } else {
    console.log('[REPORT-WORKER] Report worker standing by.');
  }
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  main().catch((err) => {
    console.error('Fatal error in report worker:', err);
    process.exit(1);
  });
}

export { main };
