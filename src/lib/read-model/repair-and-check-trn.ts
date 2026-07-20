import '@/lib/read-model/bootstrap-env';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { withClient } from '@/lib/read-model/db';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';

const trn = process.argv[2];

if (!trn) {
  console.error('Usage: npx tsx src/lib/read-model/repair-and-check-trn.ts <TRN>');
  process.exit(1);
}

async function main() {
  const crmRows = await fetchCrmRowsByTrns([trn], { includeTransferred: true });
  console.log('crmRows', crmRows.length);

  await withClient(async (client) => {
    const before = await client.query(
      `SELECT vtrnno, status_bucket, status_label, source_editedon, bsolved, bfastclose, solved_at, edited_at
       FROM calls_latest_hot WHERE vtrnno = $1`,
      [trn]
    );
    console.log('before', before.rows[0] ?? null);

    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) throw new Error('sync lock not acquired');
    try {
      const state = await getSyncState(client);
      const applied = await applyCrmRowsToHot(client, crmRows, {
        state,
        advanceWatermarks: false,
      });
      console.log('applied', applied);
      await releaseSyncLock(client, 'ok', applied.rowsUpserted);
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }

    const after = await client.query(
      `SELECT vtrnno, status_bucket, status_label, source_editedon, bsolved, bfastclose, solved_at, edited_at
       FROM calls_latest_hot WHERE vtrnno = $1`,
      [trn]
    );
    console.log('after', after.rows[0] ?? null);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
