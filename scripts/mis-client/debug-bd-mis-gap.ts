import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryFiltered } from '@/features/mis-import/services/aggregate';
import {
  buildBdMisRegionalBreakdown,
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
} from '@/features/report/services/bd-mis-summary';
import { withAppClient } from '@/lib/read-model/db';

const END = '2026-06-29';

async function main() {
  const params = {
    startDate: '2026-01-01',
    endDate: END,
    agingAsOf: END,
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };

  const crm = await queryBdMisCrmSummary(params);
  const client = await queryClientAccountSummaryFiltered({
    ...params,
    sourceCodes: ['coke', 'cadbury'],
  });

  const breakdown = buildBdMisRegionalBreakdown({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });

  for (const b of breakdown) {
    if (b.region !== 'SOUTH ZONE' && b.region !== 'WEST ZONE') continue;
    console.log(`\n=== ${b.region} breakdown ===`);
    console.log('  crmBranchBase:', b.crmBranchBase.total_calls);
    console.log('  subtractCrmCadbury:', b.subtractCrmCadbury.total_calls);
    console.log('  addClientCadbury:', b.addClientCadbury.total_calls);
    console.log('  subtractCrmCoke:', b.subtractCrmCoke.total_calls, 'open', b.subtractCrmCoke.age_2 + b.subtractCrmCoke.age_3 + b.subtractCrmCoke.age_7 + b.subtractCrmCoke.age_15);
    console.log('  addClientCoke:', b.addClientCoke.total_calls, 'open', b.addClientCoke.age_2 + b.addClientCoke.age_3 + b.addClientCoke.age_7 + b.addClientCoke.age_15);
    console.log('  result:', b.result.total_calls, 'open', b.result.open_calls);
  }

  // HCCB without date filter (latest batch all rows)
  await withAppClient(async (c) => {
    const allHccb = await c.query<{ n: number; open: number }>(`
      WITH latest AS (
        SELECT DISTINCT ON (r.source_id, r.call_key) r.status_bucket, r.logged_at, r.is_part_pending
        FROM mis_client_import_rows r
        JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
        JOIN mis_client_sources s ON s.id = r.source_id
        WHERE s.code = 'coke' AND b.status = 'completed'
        ORDER BY r.source_id, r.call_key, b.created_at DESC
      )
      SELECT count(*)::int n,
        count(*) FILTER (WHERE status_bucket IN ('assigned','open_unallocated'))::int as open
      FROM latest
    `);
    const ytdHccb = await c.query<{ n: number }>(`
      WITH latest AS (
        SELECT DISTINCT ON (r.source_id, r.call_key) r.logged_at
        FROM mis_client_import_rows r
        JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
        JOIN mis_client_sources s ON s.id = r.source_id
        WHERE s.code = 'coke' AND b.status = 'completed'
        ORDER BY r.source_id, r.call_key, b.created_at DESC
      )
      SELECT count(*)::int n FROM latest
      WHERE logged_at >= '2026-01-01' AND logged_at <= '2026-06-29 23:59:59'
    `);
    console.log('\n=== HCCB import counts ===');
    console.log('  All rows (no date filter):', allHccb.rows[0].n, 'open', allHccb.rows[0].open);
    console.log('  YTD Jan1-Jun29:', ytdHccb.rows[0].n);
    console.log('  Excel HCCB line:', 30774);
  });

  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const grand = sumBdMisRegionalGrand(rows);
  console.log('\nGrand total:', grand.total_calls, '(excel 197793, delta', grand.total_calls - 197793, ')');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
