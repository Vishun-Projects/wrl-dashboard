/**
 * Compare Postgres arcp_lines_hot aggregates vs CRM for a narrow window (cutover check).
 *
 * Usage: npx tsx scripts/verify-arcp-postgres-tally.ts [startDate] [endDate] [branch]
 */
import '@/lib/read-model/bootstrap-env';
import { fetchArcpClaimsAggregates } from '@/features/arcp/lib/server/fetch';
import { mergeArcpAggregateRows } from '@/features/arcp/lib/query';
import { queryArcpClaimsAggregates } from '@/features/arcp/lib/server/postgres';

const startDate = process.argv[2] || '2025-01-01';
const endDate = process.argv[3] || '2025-01-07';
const branch = process.argv[4];

async function main() {
  const opts = {
    startDate,
    endDate,
    dateFilterColumn: 'approve' as const,
    branch: branch || undefined,
  };

  console.log(`Verifying ARCP tally ${startDate} → ${endDate}${branch ? ` branch ${branch}` : ''}\n`);

  const [pgRows, crmRows] = await Promise.all([
    queryArcpClaimsAggregates(opts),
    fetchArcpClaimsAggregates(opts, 180000).then((rows) => mergeArcpAggregateRows(rows)),
  ]);

  const sum = (rows: typeof pgRows, field: 'amount_payable' | 'qty') =>
    rows.reduce((acc, r) => acc + Number(r[field] ?? 0), 0);

  console.log('Postgres:', {
    groups: pgRows.length,
    qty: sum(pgRows, 'qty'),
    amount_payable: sum(pgRows, 'amount_payable'),
  });
  console.log('CRM:', {
    groups: crmRows.length,
    qty: sum(crmRows, 'qty'),
    amount_payable: sum(crmRows, 'amount_payable'),
  });

  const qtyDiff = Math.abs(sum(pgRows, 'qty') - sum(crmRows, 'qty'));
  const amtDiff = Math.abs(sum(pgRows, 'amount_payable') - sum(crmRows, 'amount_payable'));
  if (qtyDiff === 0 && amtDiff < 1) {
    console.log('\nOK — totals match within tolerance.');
  } else {
    console.log('\nMISMATCH — review sync / filters before cutover.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
