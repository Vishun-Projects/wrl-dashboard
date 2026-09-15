#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { syncCompressorBarcodesToPostgres } from './postgres-sync';

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('[compressor-barcodes-sync] Starting sync process...');
  const result = await syncCompressorBarcodesToPostgres();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[compressor-barcodes-sync] Finished successfully in ${elapsed}s:`, result);
}

main()
  .catch((err) => {
    console.error('[compressor-barcodes-sync] Fatal error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
