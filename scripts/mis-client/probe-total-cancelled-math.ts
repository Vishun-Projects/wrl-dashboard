import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
config({ path: join(process.cwd(), '.env.local') });
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/lib/mis-client-import/aggregate';
import { buildBdMisRegionalRows, sumBdMisRegionalGrand } from '@/lib/report/bd-mis-summary';
import { withAppClient } from '@/lib/read-model/db';

const p = {
  startDate: '2026-01-01',
  endDate: '2026-06-29',
  agingAsOf: '2026-06-29',
  callTypes: ['BREAKDOWN'],
  isHod: true,
};

function loadCsvTrns(): Set<string> {
  const lines = readFileSync(
    'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv',
    'utf8'
  ).split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(',');
  const idIdx = h.findIndex((x) => x.replace(/"/g, '').trim() === 'ID');
  const ctIdx = h.findIndex((x) => x.replace(/"/g, '').trim() === 'Call Type');
  const dateIdx = h.findIndex((x) => x.replace(/"/g, '').trim() === 'Date');
  const set = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].match(/("([^"]|"")*"|[^,]*)/g) ?? [];
    const callType = (parts[ctIdx] ?? '').replace(/"/g, '').trim();
    if (callType.toUpperCase() !== 'BREAKDOWN') continue;
    const id = (parts[idIdx] ?? '').replace(/"/g, '').trim();
    if (id) set.add(id);
  }
  return set;
}

async function main() {
  const crm = await queryBdMisCrmSummary(p);
  const client = await queryClientAccountSummaryForBdMis({
    ...p,
    sourceCodes: ['coke', 'cadbury'],
  });
  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const g = sumBdMisRegionalGrand(rows);

  const hot = await withAppClient(async (c) => {
    const r = await c.query<{
      non_cancelled: number;
      cancelled: number;
      all_n: number;
    }>(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS non_cancelled,
        count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled,
        count(*)::int AS all_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'
    `);
    return r.rows[0];
  });

  console.log('=== Column math (portal) ===');
  console.log(`Total calls (excl cancelled): ${g.total_calls.toLocaleString()}`);
  console.log(`Cancelled:                  ${g.cancelled_calls.toLocaleString()}`);
  console.log(`Total + Cancelled (all):      ${(g.total_calls + g.cancelled_calls).toLocaleString()}`);
  console.log(`Solved + Open:                ${(g.total_solved + g.open_calls).toLocaleString()} (= total)`);
  console.log(`Excel Total (ref):            197,793`);
  console.log(`Δ Total vs Excel:             ${g.total_calls - 197793}`);

  console.log('\n=== CRM hot only (practice excluded) ===');
  console.log(`Non-cancelled: ${hot.non_cancelled.toLocaleString()}`);
  console.log(`Cancelled:     ${hot.cancelled.toLocaleString()}`);
  console.log(`All rows:      ${hot.all_n.toLocaleString()} (= non-cancelled + cancelled)`);

  for (const row of rows) {
    const all = row.total_calls + row.cancelled_calls;
    const check = row.total_solved + row.open_calls;
    if (check !== row.total_calls) {
      console.log(`ZONE MISMATCH ${row.region}: total=${row.total_calls} solved+open=${check}`);
    }
  }
}

main().catch(console.error);
