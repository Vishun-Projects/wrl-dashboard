import { postQuery } from '../src/lib/db/proxy';
import { buildArcpClaimsGrandTotalSql, parseArcpGrandTotals } from '../src/lib/arcp-claims/query';

async function main() {
  const opts = {
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    dateFilterColumn: 'bm_approved_at' as const,
    franchisee: '152',
    isHod: true,
    crmUiFast: true,
  };
  const res = await postQuery({
    rawSql: buildArcpClaimsGrandTotalSql(opts),
    timeoutMs: 120_000,
  });
  const t = parseArcpGrandTotals((res.data?.[0] ?? {}) as Record<string, unknown>);
  console.log('Portal tally (serial BM filter, winning-line branch/HO):');
  console.log('  Lines:', t.lineCount);
  console.log('  Amount payable:', t.amountPayable.toFixed(2));
  console.log('  Branch approved:', t.branchApproved.toFixed(2));
  console.log('  HO approved:', t.hoApproved.toFixed(2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
