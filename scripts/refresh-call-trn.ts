/**
 * Force-refresh one or more TRNs from CRM into calls_latest_hot.
 * Usage: npx tsx scripts/refresh-call-trn.ts 26F01029
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { withClient, closePool } from '@/lib/read-model/db';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';

const trns = process.argv.slice(2).map((t) => t.trim()).filter(Boolean);
if (!trns.length) {
  console.error('Usage: npx tsx scripts/refresh-call-trn.ts <vtrnno> [...]');
  process.exit(1);
}

async function main() {
  const rows = await fetchCrmRowsByTrns(trns, { includeTransferred: true });
  console.log(`CRM fetched ${rows.length} row(s) for ${trns.join(', ')}`);
  for (const row of rows) {
    console.log({
      vtrnno: row.vtrnno,
      ncancelreason: row.ncancelreason,
      editedon: row.editedon,
    });
  }
  if (!rows.length) {
    console.error('No CRM row returned (check TRN or CRM connectivity)');
    process.exitCode = 1;
    return;
  }

  await withClient(async (client) => {
    if (!(await tryAcquireSyncLock(client))) {
      throw new Error('sync lock not acquired');
    }
    try {
      const state = await getSyncState(client);
      const result = await applyCrmRowsToHot(client, rows, {
        state,
        advanceWatermarks: false,
      });
      await releaseSyncLock(client, 'ok', result.rowsUpserted);
      console.log('Result:', result);
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
