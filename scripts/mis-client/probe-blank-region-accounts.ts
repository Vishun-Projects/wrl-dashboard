import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/sql/read-model/summary-call-filters';
import { queryBdMisCrmSummary } from '@/sql/read-model/bd-mis-summary';

async function main() {
  await withAppClient(async (c) => {
    const blank = await c.query<{
      account: string;
      n: number;
      open_n: number;
      vtrnno: string;
    }>(`
      SELECT h.account, h.vtrnno,
        1::int AS n,
        CASE WHEN h.status_bucket IN ('open_unallocated','assigned') THEN 1 ELSE 0 END AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
        AND (h.region IS NULL OR trim(h.region) = '')
      ORDER BY h.account, h.vtrnno
    `);
    console.log('=== Calls with blank region (matches empty Region in morning CSV) ===');
    console.log('Count:', blank.rows.length);
    for (const r of blank.rows) {
      console.log(`  ${r.vtrnno} | ${r.account} | open=${r.open_n}`);
    }

    const byAcct = new Map<string, { n: number; open: number }>();
    for (const r of blank.rows) {
      const a = byAcct.get(r.account) ?? { n: 0, open: 0 };
      a.n++;
      a.open += Number(r.open_n);
      byAcct.set(r.account, a);
    }
    console.log('\nBy account:');
    for (const [acct, v] of byAcct) console.log(`  ${acct}: ${v.n} calls, ${v.open} open`);
  });

  const crm = await queryBdMisCrmSummary({
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
    callTypes: ['BREAKDOWN'],
    isHod: true,
  });

  const otherOrBlank = crm.accountSummary.filter((a) => {
    const r = String(a.region ?? '').trim();
    return !r || r === 'OTHER' || !r.includes('ZONE');
  });
  console.log('\n=== accountSummary rows with no standard ZONE label ===');
  for (const a of otherOrBlank) {
    console.log(`  region="${a.region}" account=${a.account} total=${a.total_calls} open=${a.open_calls}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
