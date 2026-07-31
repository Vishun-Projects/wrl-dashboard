import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { querySummaryDashboard } from '@/sql/read-model/summary';
import { queryClientAccountSummaryFiltered } from '@/modules/mis/client-import/services/aggregate';
import {
  sumMergedAccountMetricByRegion,
} from '@/modules/mis/components/SummaryMergedMetricCell';

async function main() {
  const start = '2026-07-01';
  const end = '2026-07-03';
  const crm = await querySummaryDashboard({
    startDate: start,
    endDate: end,
    agingAsOf: end,
    callTypes: ['BREAKDOWN'],
  });
  const client = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke', 'cadbury'],
    startDate: start,
    endDate: end,
    agingAsOf: end,
  });

  const mergeFlags = { crm: true, client: true };
  const mergePrefs = { cadbury: false, coke: true };

  for (const region of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']) {
    const merged = sumMergedAccountMetricByRegion(
      crm.accountSummary,
      client,
      region,
      'total_solved',
      mergeFlags,
      mergePrefs
    );
    const crmOnly = crm.accountSummary
      .filter((a) => a.region === region)
      .reduce((s, a) => s + a.total_solved, 0);
    console.log(region, { crmOnly, merged });
  }

  const snapshot = await withAppClient(async (c) => {
    const r = await c.query(`
      WITH latest_batch AS (
        SELECT DISTINCT ON (b.source_id) b.source_id, b.batch_id
        FROM mis_client_import_batches b WHERE b.status = 'completed'
        ORDER BY b.source_id, b.created_at DESC
      )
      SELECT upper(trim(r.region)) as region, s.code,
        count(*)::int as total,
        count(*) filter (where r.status_bucket in ('solved','tech_solved'))::int as solved
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      JOIN latest_batch lb ON lb.source_id = r.source_id AND lb.batch_id = r.batch_id
      WHERE s.code in ('coke','cadbury')
      GROUP BY 1,2 ORDER BY 1,2`);
    return r.rows;
  });
  console.log('\nSnapshot file totals (no date filter):');
  console.log(snapshot);
}

main().catch(console.error);
