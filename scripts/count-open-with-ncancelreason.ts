import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { isRegisterRowCancelled } from '@/lib/report/search';
import { transformCrmRowToHot } from '@/lib/read-model/transform';

const YTD = '2026-01-01';
const SAMPLE = 300;
const BATCH = 40;

async function main() {
  await withAppClient(async (c) => {
    const inconsistent = await c.query(`
      SELECT count(*)::int AS n
      FROM calls_latest_hot
      WHERE logged_at >= $1::timestamptz
        AND status_bucket IN ('assigned', 'open_unallocated')
        AND coalesce(ncancelreason, 0) NOT IN (0, 2)
    `, [YTD]);
    console.log('Hot: open/assigned + ncancelreason (not 0/2):', inconsistent.rows[0].n);

    const allOpen = await c.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= $1::timestamptz
        AND status_bucket IN ('assigned', 'open_unallocated')
    `, [YTD]);
    console.log('Hot: total open/assigned YTD:', allOpen.rows[0].n);
  });

  const candidates = await withAppClient(async (c) => {
    const res = await c.query(
      `
      SELECT vtrnno, status_bucket, ncancelreason, account
      FROM calls_latest_hot
      WHERE logged_at >= $1::timestamptz
        AND status_bucket IN ('assigned', 'open_unallocated')
      ORDER BY synced_at ASC NULLS FIRST
      LIMIT $2
      `,
      [YTD, SAMPLE]
    );
    return res.rows;
  });

  let crmCancelHotOpen = 0;
  let hotNcrOpen = 0;
  const examples: string[] = [];

  for (let i = 0; i < candidates.length; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    const crmRows = await fetchCrmRowsByTrns(chunk.map((r) => r.vtrnno));
    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno).trim(), r]));

    for (const hot of chunk) {
      const hotNcr = Number(hot.ncancelreason ?? 0);
      if (hotNcr !== 0 && hotNcr !== 2) hotNcrOpen++;

      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) continue;
      const crmNcr = Number(crm.ncancelreason ?? 0);
      const cancelled = isRegisterRowCancelled(crm);
      const fresh = transformCrmRowToHot(crm);

      if (cancelled && hot.status_bucket !== 'cancelled') {
        crmCancelHotOpen++;
        if (examples.length < 15) {
          examples.push(
            `${hot.vtrnno}: hot=${hot.status_bucket}/ncr=${hotNcr} crm_ncr=${crmNcr} → should be ${fresh?.status_bucket}`
          );
        }
      }
    }
  }

  console.log(`\nCRM sample (${candidates.length} open/assigned, oldest synced first):`);
  console.log(`  CRM cancelled, hot still open/assigned: ${crmCancelHotOpen}`);
  console.log(`  Hot has ncancelreason (not 0/2): ${hotNcrOpen}`);
  if (examples.length) {
    console.log('\nExamples:');
    for (const e of examples) console.log(' ', e);
  }

  const rate = candidates.length ? crmCancelHotOpen / candidates.length : 0;
  const totalOpen = await withAppClient(async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int n FROM calls_latest_hot
       WHERE logged_at >= $1::timestamptz AND status_bucket IN ('assigned','open_unallocated')`,
      [YTD]
    );
    return r.rows[0].n;
  });
  console.log(`\nEst. CRM-cancelled but hot-open (YTD ~${totalOpen} open): ~${Math.round(totalOpen * rate)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
