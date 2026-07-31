import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import {
  HOT_OFFICE_JOINS_SQL,
  HOT_RESOLVED_REGION_SQL,
} from '@/sql/read-model/hot-region';

async function main() {
  await withAppClient(async (c) => {
    const blank = await c.query(`SELECT count(*)::int AS n FROM calls_latest_hot WHERE trim(region) = '' OR region IS NULL`);
    console.log('Blank regions:', blank.rows[0]?.n);

    const r = await c.query(`
      SELECT
        ${HOT_RESOLVED_REGION_SQL} AS region,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_calls
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      ${HOT_OFFICE_JOINS_SQL}
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at < '2026-06-30'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND NOT (COALESCE(d.vcompanyname,'') ILIKE '%practice%' OR COALESCE(d.vcompanyname,'') ILIKE '%winmax%')
      GROUP BY 1 ORDER BY 1
    `);
    let grand = 0;
    for (const row of r.rows) {
      console.log(row);
      grand += row.open_calls;
    }
    console.log('Grand open:', grand, '(Excel: 8773)');
  });
}
main();
