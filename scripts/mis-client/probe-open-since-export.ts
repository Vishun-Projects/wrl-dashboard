/**
 * Can YTD open increase after register export? Compare export vs live hot + sync times.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/features/mis-import/services/aggregate';
import { buildBdMisRegionalRows, sumBdMisRegionalGrand } from '@/features/report/services/bd-mis-summary';

const CSV =
  'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';
/** Portal export file dated 30-Jun — treat as "export done today for YTD" */
const EXPORT_DAY_START = '2026-06-30T00:00:00';

function parseCsvLine(line: string): string[] {
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
}

function classifyFromExport(statusRaw: string, solvedDateRaw: string): 'open' | 'solved' | 'cancelled' {
  const lower = statusRaw.trim().toLowerCase();
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(solvedDateRaw.trim());
  const solvedIso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  if (lower === 'cancelled' || lower.includes('cancel')) return 'cancelled';
  const solvedByLabel =
    lower.includes('closed') ||
    lower === 'solved' ||
    lower === 'pending' ||
    lower.includes('tech');
  if (solvedIso || solvedByLabel) return 'solved';
  return 'open';
}

function loadExportOpenIds(): Set<string> {
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);
  const open = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const dateRaw = c[idx('Date')] ?? '';
    const dm = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateRaw.trim());
    if (!dm) continue;
    const isoDate = `${dm[3]}-${dm[2]}-${dm[1]}`;
    if (isoDate < '2026-01-01' || isoDate > '2026-06-29') continue;
    const cls = classifyFromExport(c[idx('Status')] ?? '', c[idx('Solved Date')] ?? '');
    if (cls !== 'open') continue;
    const id = String(c[idx('ID')] ?? '').trim();
    if (id) open.add(id);
  }
  return open;
}

async function main() {
  const exportOpenIds = loadExportOpenIds();

  const p = {
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
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

  let crmOpen = 0;
  for (const b of crm.branchSummary) crmOpen += b.open_calls ?? 0;

  console.log('=== Open calls: export file vs live dashboard ===\n');
  console.log(`Register export (portal logic on file): ${exportOpenIds.size} CRM open TRNs`);
  console.log(`Live CRM rollup (dashboard):            ${crmOpen} open`);
  console.log(`Live union (dashboard All row):         ${grand.open_calls} open`);
  console.log(`Excel Summary target:                 8773 open`);

  await withAppClient(async (c) => {
    const hotOpen = await c.query<{ vtrnno: string; synced_at: Date; status_label: string }>(`
      SELECT h.vtrnno, h.synced_at, h.status_label
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket IN ('open_unallocated','assigned')
        AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'
    `);

    let openInExport = 0;
    let openNotInExport = 0;
    let flippedAfterExport = 0;
    const samples: string[] = [];

    for (const row of hotOpen.rows) {
      if (exportOpenIds.has(row.vtrnno)) openInExport++;
      else {
        openNotInExport++;
        if (row.synced_at >= new Date(EXPORT_DAY_START) && samples.length < 8) {
          samples.push(`${row.vtrnno} synced ${row.synced_at.toISOString().slice(0, 16)} ${row.status_label}`);
        }
      }
      if (
        !exportOpenIds.has(row.vtrnno) &&
        row.synced_at >= new Date(EXPORT_DAY_START)
      ) {
        flippedAfterExport++;
      }
    }

    const exportOpenNowSolved = await c.query<{ n: number }>(`
      SELECT count(*)::int AS n
      FROM calls_latest_hot h
      WHERE h.vtrnno = ANY($1::text[])
        AND h.status_bucket IN ('solved','tech_solved')
    `, [[...exportOpenIds]]);

    console.log('\n=== CRM hot open TRNs vs this morning export ===');
    console.log(`  Still open (in export + hot):     ${openInExport}`);
    console.log(`  Open in hot but NOT in export:    ${openNotInExport}`);
    console.log(`  Of those, synced since 30-Jun:   ${flippedAfterExport}`);
    console.log(`  Export-open now solved in hot:   ${exportOpenNowSolved.rows[0].n} (solved since export)`);

    if (samples.length) {
      console.log('\n  Sample opens not in export (synced 30-Jun):');
      for (const s of samples) console.log('   ', s);
    }

    const unionExtra = grand.open_calls - 8773;
    const crmVsExport = crmOpen - exportOpenIds.size;
    const clientLayerOpen = grand.open_calls - crmOpen;
    console.log('\n=== Where +14 vs Excel comes from ===');
    console.log(`  CRM vs export file:     ${crmVsExport >= 0 ? '+' : ''}${crmVsExport}`);
    console.log(`  Client union layer:     ~${clientLayerOpen} open (Cadbury+HCCB net)`);
    console.log(`  Total vs Excel 8773:    +${unionExtra}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
