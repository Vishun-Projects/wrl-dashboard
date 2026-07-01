/**
 * Re-fetch live CRM rows and upsert into calls_latest_hot (fixes blank/wrong region).
 *
 * Usage:
 *   npx tsx scripts/mis-client/fix-hot-region-from-crm.ts [--all-blank]
 */
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState } from '@/lib/read-model/lock';

async function listBlankRegionTrns(): Promise<string[]> {
  return withAppClient(async (c) => {
    const r = await c.query<{ vtrnno: string }>(`
      SELECT vtrnno
      FROM calls_latest_hot
      WHERE region IS NULL OR trim(region) = ''
      ORDER BY vtrnno
    `);
    return r.rows.map((row) => row.vtrnno);
  });
}

async function main() {
  const trns = await listBlankRegionTrns();
  console.log(`Blank region rows in hot: ${trns.length}`);
  if (!trns.length) {
    console.log('Nothing to fix.');
    return;
  }

  console.log('TRNs:', trns.join(', '));

  const crmRows = await fetchCrmRowsByTrns(trns);
  console.log(`CRM rows fetched: ${crmRows.length}`);

  if (crmRows.length) {
    await withAppClient(async (client) => {
      const state = await getSyncState(client);
      const result = await applyCrmRowsToHot(client, crmRows, {
        state,
        advanceWatermarks: false,
      });
      console.log('CRM upsert result:', result);
    });
  } else {
    console.log('No CRM rows — run fix-hot-region-from-office.ts for dim_offices backfill.');
  }

  await withAppClient(async (c) => {
    const after = await c.query(`
      SELECT vtrnno, region, account, status_bucket::text
      FROM calls_latest_hot
      WHERE vtrnno = ANY($1::text[])
      ORDER BY vtrnno
    `, [trns]);
    console.log('\nAfter fix:');
    for (const row of after.rows) console.log(row);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
