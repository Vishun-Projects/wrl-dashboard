#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { syncCompressorBarcodesToPostgres } from './postgres-sync';

const INTERVAL_MS = Number(process.env.COMPRESSOR_BARCODES_SYNC_INTERVAL_MS || 300_000); // 5 minutes default (300,000 ms)

let running = true;

process.on('SIGINT', () => {
  console.log('[compressor-barcodes-daemon] Stopping daemon (SIGINT)...');
  running = false;
});

process.on('SIGTERM', () => {
  console.log('[compressor-barcodes-daemon] Stopping daemon (SIGTERM)...');
  running = false;
});

async function runDaemonLoop() {
  console.log(
    `[compressor-barcodes-daemon] Started background sync daemon (interval: ${INTERVAL_MS / 1000}s / ${INTERVAL_MS / 60000}m)...`
  );

  while (running) {
    const t0 = Date.now();
    try {
      const nowStr = new Date().toISOString();
      console.log(`[compressor-barcodes-daemon] [${nowStr}] Running incremental sync cycle...`);
      const result = await syncCompressorBarcodesToPostgres();
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.log(
        `[compressor-barcodes-daemon] [${new Date().toISOString()}] Cycle finished in ${elapsed}s:`,
        result
      );
    } catch (err) {
      console.error(
        '[compressor-barcodes-daemon] Cycle error:',
        err instanceof Error ? err.message : err
      );
    }

    if (!running) break;

    // Sleep for INTERVAL_MS
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

runDaemonLoop()
  .catch((err) => {
    console.error('[compressor-barcodes-daemon] Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
