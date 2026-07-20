import '@/lib/read-model/bootstrap-env';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { withClient } from '@/lib/read-model/db';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';

const trn = process.argv[2];

if (!trn) {
  console.error('Usage: npx tsx src/lib/read-model/repair-trn-from-crm.ts <TRN>');
  process.exit(1);
}

async function main() {
  const crmRows = await fetchCrmRowsByTrns([trn], { includeTransferred: true });
  if (!crmRows.length) {
    throw new Error(`No CRM row found for ${trn}`);
  }

  const result = await withClient(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) throw new Error('sync lock not acquired');
    try {
      const state = await getSyncState(client);
      const applied = await applyCrmRowsToHot(client, crmRows, {
        state,
        advanceWatermarks: false,
      });
      await releaseSyncLock(client, 'ok', applied.rowsUpserted);
      return applied;
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });

  console.log(JSON.stringify({ trn, ...result }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
