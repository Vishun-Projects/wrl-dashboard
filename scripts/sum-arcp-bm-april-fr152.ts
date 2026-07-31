/**
 * Sum BM-approved ARCP totals for franchisee 152 (portal rules, trhcalls dates).
 * Usage: npx tsx scripts/sum-arcp-bm-april-fr152.ts
 */
import { postQuery } from '../src/lib/db/proxy';
import {
  buildArcpClaimsGrandTotalSql,
  buildArcpClaimsFilterCondition,
  parseArcpGrandTotals,
  planArcpSummaryDateChunks,
  type ArcpGrandTotals,
} from '../src/sql/arcp/query';

const opts = {
  startDate: '2026-04-01',
  endDate: '2026-04-30',
  dateFilterColumn: 'bm_approved_at' as const,
  franchisee: '152',
  isHod: true,
  crmUiFast: true,
};

function addTotals(a: ArcpGrandTotals, b: ArcpGrandTotals): ArcpGrandTotals {
  return {
    lineCount: a.lineCount + b.lineCount,
    serviceLineCount: a.serviceLineCount + b.serviceLineCount,
    travelLineCount: a.travelLineCount + b.travelLineCount,
    amountPayable: a.amountPayable + b.amountPayable,
    branchApproved: a.branchApproved + b.branchApproved,
    hoApproved: a.hoApproved + b.hoApproved,
  };
}

async function grandForRange(start: string, end: string): Promise<ArcpGrandTotals> {
  const sql = buildArcpClaimsGrandTotalSql({ ...opts, startDate: start, endDate: end });
  const res = await postQuery({ rawSql: sql, timeoutMs: 120_000 });
  return parseArcpGrandTotals((res.data?.[0] ?? {}) as Record<string, unknown>);
}

async function main() {
  console.log('Franchisee 152 · BM Call Approved · 2026-04-01 → 2026-04-30\n');
  console.log('Filter (truncated):', buildArcpClaimsFilterCondition(opts).slice(0, 180), '...\n');

  const chunks = planArcpSummaryDateChunks(opts);
  let sum = {
    lineCount: 0,
    serviceLineCount: 0,
    travelLineCount: 0,
    amountPayable: 0,
    branchApproved: 0,
    hoApproved: 0,
  };
  const failures: string[] = [];

  for (const ch of chunks) {
    try {
      const t = await grandForRange(ch.start, ch.end);
      sum = addTotals(sum, t);
      console.log(
        `${ch.start}  lines=${t.lineCount}  branch_approved=${t.branchApproved.toFixed(2)}  payable=${t.amountPayable.toFixed(2)}  ho=${t.hoApproved.toFixed(2)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 100) : String(err);
      failures.push(`${ch.start}: ${msg}`);
      console.log(`${ch.start}  FAILED  ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\n--- Totals (sum of successful days; same as UI merge) ---');
  console.log(`Lines:            ${sum.lineCount}`);
  console.log(`Amount payable:   ₹${sum.amountPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(`Branch approved:  ₹${sum.branchApproved.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(`HO approved:      ₹${sum.hoApproved.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  if (failures.length) {
    console.log(`\nFailed days (${failures.length}):`, failures.join('; '));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
