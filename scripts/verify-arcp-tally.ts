import { postQuery } from '../src/lib/db/proxy';
import {
  buildArcpClaimsGrandTotalSql,
  mergeArcpAggregateRows,
  parseArcpAggregateRows,
  planArcpSummaryDateChunks,
  type ArcpClaimsQueryOpts,
} from '../src/lib/arcp-claims/query';
import { buildArcpClaimsRawSql } from '../src/lib/arcp-claims/query';

const startDate = process.argv[2] || '2025-01-01';
const endDate = process.argv[3] || '2025-12-31';
const dateFilterColumn = process.argv[4] || 'approve';

const opts: ArcpClaimsQueryOpts = {
  startDate,
  endDate,
  dateFilterColumn,
  callType: 'All',
  isHod: true,
};

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumTotals(rows: { qty?: unknown; amount_payable?: unknown; branch_approved?: unknown; ho_approved?: unknown }[]) {
  type Totals = { qty: number; amount_payable: number; branch_approved: number; ho_approved: number };
  return rows.reduce<Totals>(
    (acc, row) => ({
      qty: acc.qty + toNum(row.qty),
      amount_payable: acc.amount_payable + toNum(row.amount_payable),
      branch_approved: acc.branch_approved + toNum(row.branch_approved),
      ho_approved: acc.ho_approved + toNum(row.ho_approved),
    }),
    { qty: 0, amount_payable: 0, branch_approved: 0, ho_approved: 0 }
  );
}

async function runGrandTotal(label: string, queryOpts: ArcpClaimsQueryOpts) {
  const sql = buildArcpClaimsGrandTotalSql(queryOpts);
  const res = await postQuery({ rawSql: sql, timeoutMs: 180000 });
  const row = (res.data || [])[0] as Record<string, unknown> | undefined;
  console.log(`\n${label}`);
  console.log(JSON.stringify(row ?? res, null, 2));
  return row;
}

async function runChunkedSummary(label: string, queryOpts: ArcpClaimsQueryOpts) {
  const chunks = planArcpSummaryDateChunks(queryOpts);
  let merged: ReturnType<typeof parseArcpAggregateRows> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    process.stdout.write(`  chunk ${i + 1}/${chunks.length} ${chunk.start}..${chunk.end}\r`);
    const sql = buildArcpClaimsRawSql({
      ...queryOpts,
      startDate: chunk.start,
      endDate: chunk.end,
    });
    const res = await postQuery({ rawSql: sql, timeoutMs: 180000 });
    const rows = parseArcpAggregateRows((res.data || []) as Record<string, unknown>[]);
    merged = merged.length === 0 ? rows : mergeArcpAggregateRows([...merged, ...rows]);
  }

  console.log(`\n${label} (${chunks.length} chunks)`);
  const totals = sumTotals(merged);
  console.log(JSON.stringify(totals, null, 2));
  console.log(`  aggregate groups: ${merged.length}`);
  return totals;
}

console.log(`ARCP tally verification ${startDate} → ${endDate} (${dateFilterColumn})`);

async function main() {
  await runGrandTotal('Grand total (single SQL, distinct ncode)', opts);
  await runChunkedSummary('Chunked summary merged (same as UI)', opts);
}

main().catch((err) => {
  console.error('Verification failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
