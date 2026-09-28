#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { syncCompressorBarcodesToPostgres } from './postgres-sync';

async function main(): Promise<void> {
  const t0 = Date.now();
  const forceFull = process.argv.includes('--full');
  console.log(`[compressor-barcodes-sync] Starting sync process${forceFull ? ' (full)' : ''}...`);
  const result = await syncCompressorBarcodesToPostgres({ forceFull });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[compressor-barcodes-sync] Finished successfully in ${elapsed}s:`, result);
}

main()
  .catch((err) => {
    console.error('[compressor-barcodes-sync] Fatal error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
