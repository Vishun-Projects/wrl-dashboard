#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import {
  backfillDefectiveSerialsReturnByNames,
  syncDefectiveSerialsToPostgres,
} from './postgres-sync';

async function main(): Promise<void> {
  const t0 = Date.now();
  const forceFull = process.argv.includes('--full');
  const backfillNamesOnly = process.argv.includes('--backfill-return-by');

  if (backfillNamesOnly) {
    console.log('[defective-serials-sync] Backfilling return_by_name…');
    const result = await backfillDefectiveSerialsReturnByNames();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[defective-serials-sync] Finished in ${elapsed}s:`, result);
    return;
  }

  console.log(`[defective-serials-sync] Starting${forceFull ? ' (full)' : ''}…`);
  const result = await syncDefectiveSerialsToPostgres({ forceFull });
  // Fill names for any rows still missing (e.g. first load before CRM join).
  const names = await backfillDefectiveSerialsReturnByNames();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[defective-serials-sync] Finished in ${elapsed}s:`, { ...result, names });
}

main()
  .catch((err) => {
    console.error(
      '[defective-serials-sync] Fatal:',
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(() => closePool());
