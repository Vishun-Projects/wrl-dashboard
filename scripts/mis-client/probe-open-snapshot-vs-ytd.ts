/**
 * Same files, same YTD — does portal union open match Excel when client rows are date-filtered?
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryFiltered } from '@/features/mis-import/services/aggregate';
import {
  buildBdMisRegionalRows,
  openCallsFromTotals,
  sumBdMisRegionalGrand,
} from '@/features/report/services/bd-mis-summary';

const END = '2026-06-29';
const p = {
  startDate: '2026-01-01',
  endDate: END,
  agingAsOf: END,
  callTypes: ['BREAKDOWN'],
  isHod: true,
};

const EXCEL = {
  'NORTH ZONE': { open: 2501, solved: 65854, total: 68355 },
  'EAST ZONE': { open: 1496, solved: 28635, total: 30131 },
  'WEST ZONE': { open: 1542, solved: 23547, total: 25089 },
  'SOUTH ZONE': { open: 3234, solved: 70984, total: 74218 },
  GRAND: { open: 8773, solved: 189020, total: 197793 },
};

async function unionWithClientMode(snapshotMode: boolean) {
  const crm = await queryBdMisCrmSummary(p);
  const client = await queryClientAccountSummaryFiltered({
    ...p,
    sourceCodes: ['coke', 'cadbury'],
    bdMisSnapshotMode: snapshotMode,
  });
  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const grand = sumBdMisRegionalGrand(rows);
  return { rows, grand, client };
}

async function main() {
  const snapshot = await unionWithClientMode(true);
  const ytdFiltered = await unionWithClientMode(false);

  console.log('=== Portal union open: snapshot batch (current) vs YTD-filtered client rows ===\n');
  console.log(
    'Mode'.padEnd(22),
    'Grand open'.padStart(10),
    'Grand solved'.padStart(12),
    'Grand total'.padStart(12),
    'Δ open vs Excel'.padStart(16)
  );
  for (const [label, pack] of [
    ['Excel (his file)', { grand: { open_calls: EXCEL.GRAND.open, total_solved: EXCEL.GRAND.solved, total_calls: EXCEL.GRAND.total } }],
    ['Portal snapshot batch', snapshot],
    ['Portal YTD on client', ytdFiltered],
  ] as const) {
    const g = pack.grand;
    const dOpen = g.open_calls - EXCEL.GRAND.open;
    console.log(
      label.padEnd(22),
      String(g.open_calls).padStart(10),
      String(g.total_solved).padStart(12),
      String(g.total_calls).padStart(12),
      (dOpen >= 0 ? `+${dOpen}` : String(dOpen)).padStart(16)
    );
  }

  console.log('\n=== Open by zone (snapshot vs YTD client vs Excel) ===');
  for (const zone of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE'] as const) {
    const ex = EXCEL[zone].open;
    const snap = snapshot.rows.find((r) => r.region === zone)!.open_calls;
    const ytd = ytdFiltered.rows.find((r) => r.region === zone)!.open_calls;
    console.log(
      `${zone}: Excel ${ex} | snapshot ${snap} (Δ${snap - ex}) | YTD client ${ytd} (Δ${ytd - ex})`
    );
  }

  let snapCadOpen = 0;
  let ytdCadOpen = 0;
  for (const a of snapshot.client) {
    if ((a.account ?? '').toLowerCase() === 'cadbury') snapCadOpen += openCallsFromTotals(a);
  }
  for (const a of ytdFiltered.client) {
    if ((a.account ?? '').toLowerCase() === 'cadbury') ytdCadOpen += openCallsFromTotals(a);
  }
  console.log('\n=== Client Cadbury open (all zones) ===');
  console.log(`  Snapshot batch: ${snapCadOpen}`);
  console.log(`  YTD filtered:   ${ytdCadOpen}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
