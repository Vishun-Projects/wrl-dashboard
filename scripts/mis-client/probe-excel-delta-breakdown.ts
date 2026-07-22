/**
 * Where +412 total / +398 solved / +14 open vs Excel come from.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/features/mis-import/lib/aggregate';
import { buildBdMisRegionalRows, sumBdMisRegionalGrand } from '@/features/report/lib/bd-mis-summary';

const END = '2026-06-29';
const EXCEL = { total: 197793, solved: 189020, open: 8773 };

function loadCsvTrns(): Set<string> {
  const lines = readFileSync(
    'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv',
    'utf8'
  ).split(/\r?\n/).filter(Boolean);
  const header = lines[0];
  const cols = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (const c of line) {
      if (c === '"') {
        inQ = !inQ;
        continue;
      }
      if (c === ',' && !inQ) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out;
  };
  const h = cols(header);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);
  const set = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const c = cols(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const id = String(c[idx('ID')] ?? '').trim();
    if (id) set.add(id);
  }
  return set;
}

async function main() {
  const csvTrns = loadCsvTrns();
  const trnList = [...csvTrns];

  const p = {
    startDate: '2026-01-01',
    endDate: END,
    agingAsOf: END,
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };
  const crm = await queryBdMisCrmSummary(p);
  const client = await queryClientAccountSummaryForBdMis({ ...p, sourceCodes: ['coke', 'cadbury'] });
  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const grand = sumBdMisRegionalGrand(rows);

  console.log('=== Portal vs Excel (active calls, excl cancelled) ===');
  console.log({
    portal: { total: grand.total_calls, solved: grand.total_solved, open: grand.open_calls },
    excel: EXCEL,
    delta: {
      total: grand.total_calls - EXCEL.total,
      solved: grand.total_solved - EXCEL.solved,
      open: grand.open_calls - EXCEL.open,
    },
  });

  await withAppClient(async (c) => {
    const practice = await c.query(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS non_cancelled,
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') ~* '(PRACTICE|WINMAX)'
    `);
    console.log('\n=== Practice/WinMax rows IN PERIOD (would be excluded from CRM query) ===');
    console.log(practice.rows[0]);

    const notInCsv = await c.query<{
      non_cancelled: number;
      solved: number;
      open_n: number;
      cancelled: number;
      practice_nc: number;
    }>(
      `
      SELECT
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS non_cancelled,
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled,
        count(*) FILTER (
          WHERE h.status_bucket != 'cancelled'
            AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') ~* '(PRACTICE|WINMAX)'
        )::int AS practice_nc
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND NOT (h.vtrnno = ANY($1::text[]))
      `,
      [trnList]
    );
    console.log('\n=== CRM hot rows NOT in frozen portal CSV (by status) ===');
    console.log(notInCsv.rows[0]);
    console.log('(These are mostly fill-ytd extras; explains most of Δ total/solved/open)');

    const crmOnly = await c.query<{ solved: number; open_n: number; total_nc: number }>(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS total_nc
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    `);
    let crmBranchSolved = 0;
    let crmBranchOpen = 0;
    let crmBranchTotal = 0;
    for (const b of crm.branchSummary) {
      crmBranchSolved += b.solved_calls ?? 0;
      crmBranchOpen += b.open_calls ?? 0;
      crmBranchTotal += b.total_calls ?? 0;
    }
    console.log('\n=== CRM layer (practice/winmax EXCLUDED) ===');
    console.log({
      branchRollup: { total: crmBranchTotal, solved: crmBranchSolved, open: crmBranchOpen },
      hotDirect: crmOnly.rows[0],
    });

    let clientSolved = 0;
    let clientOpen = 0;
    let clientTotal = 0;
    for (const a of client) {
      clientTotal += a.total_calls ?? 0;
      clientSolved += a.total_solved ?? 0;
      clientOpen += (a.total_calls ?? 0) - (a.total_solved ?? 0);
    }
    console.log('\n=== Client import layer (Cadbury + HCCB snapshot) ===');
    console.log({ total: clientTotal, solved: clientSolved, openApprox: clientOpen });
  });

  console.log('\n=== Open Δ by zone (union vs Excel) ===');
  const excelOpen: Record<string, number> = {
    'NORTH ZONE': 2501,
    'EAST ZONE': 1496,
    'WEST ZONE': 1542,
    'SOUTH ZONE': 3234,
  };
  for (const r of rows) {
    const d = r.open_calls - (excelOpen[r.region] ?? 0);
    if (d) console.log(`  ${r.region}: +${d} open`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
