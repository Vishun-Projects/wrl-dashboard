#!/usr/bin/env node
import {
  syncWarrantyMasterBatch,
  getHighestNcodeInPostgres,
  getTotalMachinesInPostgres,
} from '../src/modules/warranty-master/server/sync/sync.ts';

const args = process.argv.slice(2);
let maxBatches = 0; // 0 = unlimited / sync all
let batchSize = 5000;
let reset = false;

for (const arg of args) {
  if (arg === '--reset') {
    reset = true;
  } else if (arg.startsWith('--batchSize=')) {
    batchSize = Number(arg.split('=')[1]) || 5000;
  } else if (arg.startsWith('--batches=')|| arg.startsWith('--maxBatches=')) {
    maxBatches = Number(arg.split('=')[1]) || 0;
  } else if (!isNaN(Number(arg))) {
    maxBatches = Number(arg);
  }
}

async function run() {
  const existingCount = await getTotalMachinesInPostgres();
  const startNcode = reset ? 0 : await getHighestNcodeInPostgres();

  console.log('====================================================');
  console.log('  Warranty Master - Database Sync Worker');
  console.log('====================================================');
  console.log(`Current machines in local Postgres : ${existingCount.toLocaleString()}`);
  console.log(`Resuming at ncode                  : > ${startNcode}`);
  console.log(`Batch size                         : ${batchSize.toLocaleString()} rows`);
  console.log(`Batches to run                     : ${maxBatches === 0 ? 'ALL (continuous until complete)' : maxBatches}`);
  console.log('====================================================\n');

  process.on('SIGINT', () => {
    console.log('\n[warranty-master-sync] Interrupt received. Finishing current batch and saving...');
  });

  const estimatedTotal = 1866630;
  const startTs = Date.now();

  const res = await syncWarrantyMasterBatch({
    startNcode,
    maxBatches,
    batchSize,
    onProgress: (p) => {
      const currentTotal = existingCount + p.totalInserted;
      const pct = Math.min(100, ((currentTotal / estimatedTotal) * 100)).toFixed(2);
      const remainingRows = Math.max(0, estimatedTotal - currentTotal);
      const remainingSec = p.rateRowsPerSec > 0 ? Math.round(remainingRows / p.rateRowsPerSec) : 0;
      const etaMin = Math.round(remainingSec / 60);

      const timeStr = etaMin > 60 ? `${(etaMin / 60).toFixed(1)}h` : `${etaMin}m`;

      console.log(
        `[Batch ${p.batch}] +${p.rowsInBatch.toLocaleString()} rows | Local DB: ${currentTotal.toLocaleString()}/${estimatedTotal.toLocaleString()} (${pct}%) | ${p.rateRowsPerSec} rows/s | ETA: ${timeStr} | ncode: ${p.currentNcode}`
      );
    },
  });

  const finalCount = await getTotalMachinesInPostgres();
  const elapsedMinutes = ((Date.now() - startTs) / 60000).toFixed(1);

  console.log('\n====================================================');
  console.log('  Sync Run Finished');
  console.log('====================================================');
  console.log(`Total batches processed : ${res.batchesProcessed}`);
  console.log(`Rows inserted this run  : ${res.rowsInserted.toLocaleString()}`);
  console.log(`Total machines in DB    : ${finalCount.toLocaleString()}`);
  console.log(`Completed all data?     : ${res.isComplete ? 'YES' : 'NO (incremental/paused)'}`);
  console.log(`Time elapsed            : ${elapsedMinutes} minutes`);
  console.log('====================================================\n');

  process.exit(res.ok ? 0 : 1);
}

run().catch((err) => {
  console.error('[warranty-master-sync] Fatal error:', err);
  process.exit(1);
});
