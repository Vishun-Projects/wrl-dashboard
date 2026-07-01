/**
 * Backfill blank calls_latest_hot.region from dim_offices zone (same as CRM / HOT_RESOLVED_REGION_SQL).
 *
 * Usage: npx tsx scripts/mis-client/fix-hot-region-from-office.ts [--dry-run]
 */
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';
import { HOT_OFFICE_ZONE_NAME_SQL } from '@/lib/read-model/queries/hot-region';

const dryRun = process.argv.includes('--dry-run');

const UPDATE_SQL = `
  UPDATE calls_latest_hot h
  SET region = TRIM(UPPER(${HOT_OFFICE_ZONE_NAME_SQL}))
  FROM dim_offices d_reg
  LEFT JOIN dim_offices dp_reg
    ON dp_reg.ncode = d_reg.nunder AND COALESCE(d_reg.nunder, 0) <> 0
  WHERE d_reg.ncode = h.nofficeid
    AND (h.region IS NULL OR trim(h.region) = '')
`;

async function main() {
  await withAppClient(async (c) => {
    const before = await c.query<{ n: number }>(`
      SELECT count(*)::int AS n
      FROM calls_latest_hot
      WHERE region IS NULL OR trim(region) = ''
    `);
    console.log(`Blank region rows before: ${before.rows[0]?.n ?? 0}`);

    const preview = await c.query(`
      SELECT h.vtrnno, h.account, h.status_bucket::text AS status,
        TRIM(UPPER(${HOT_OFFICE_ZONE_NAME_SQL})) AS new_region
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d_reg ON d_reg.ncode = h.nofficeid
      LEFT JOIN dim_offices dp_reg
        ON dp_reg.ncode = d_reg.nunder AND COALESCE(d_reg.nunder, 0) <> 0
      WHERE h.region IS NULL OR trim(h.region) = ''
      ORDER BY h.vtrnno
    `);
    for (const row of preview.rows) console.log(row);

    if (dryRun) {
      console.log('\nDry run — no update applied.');
      return;
    }

    const updated = await c.query(UPDATE_SQL);
    console.log(`\nUpdated rows: ${updated.rowCount ?? 0}`);

    const after = await c.query<{ n: number }>(`
      SELECT count(*)::int AS n
      FROM calls_latest_hot
      WHERE region IS NULL OR trim(region) = ''
    `);
    console.log(`Blank region rows after: ${after.rows[0]?.n ?? 0}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
