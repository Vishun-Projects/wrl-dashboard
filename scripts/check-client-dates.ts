import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { queryClientAccountSummaryFiltered } from '@/lib/mis-client-import/aggregate';

async function main() {
  const jul = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke', 'cadbury'],
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
  });
  const southJul = jul.filter((a) => /south/i.test(a.region));
  console.log('Jul 1-3 client south accounts:', southJul);

  const ytd = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke', 'cadbury'],
    startDate: '2026-01-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
  });
  const southYtd = ytd.filter((a) => /south/i.test(a.region));
  console.log('\nYTD client south accounts (top solved):', southYtd.sort((a,b)=>b.total_solved-a.total_solved).slice(0,5));

  const dates = await withAppClient(async (c) => {
    const r = await c.query(`
      WITH latest_batch AS (
        SELECT DISTINCT ON (b.source_id) b.source_id, b.batch_id
        FROM mis_client_import_batches b WHERE b.status = 'completed'
        ORDER BY b.source_id, b.created_at DESC
      )
      SELECT s.code, r.logged_at::date as day, count(*)::int as c
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      JOIN latest_batch lb ON lb.source_id = r.source_id AND lb.batch_id = r.batch_id
      WHERE upper(trim(r.region)) = 'SOUTH' AND s.code = 'coke'
      GROUP BY 1,2 ORDER BY 2 DESC LIMIT 15`);
    return r.rows;
  });
  console.log('\nCoke SOUTH snapshot logged_at distribution (latest 15 days):');
  console.log(dates);

  const { querySummaryDashboard } = await import('@/lib/read-model/queries/summary');
  const {
    sumMergedAccountMetricByRegion,
  } = await import('@/components/report/SummaryMergedMetricCell');

  const crmJul = await querySummaryDashboard({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
    callTypes: ['BREAKDOWN'],
  });
  const clientYtd = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke', 'cadbury'],
    startDate: '2026-01-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
  });
  const mergeFlags = { crm: true, client: true };
  const mergePrefs = { cadbury: false, coke: true };
  let all = 0;
  for (const region of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']) {
    const merged = sumMergedAccountMetricByRegion(
      crmJul.accountSummary,
      clientYtd,
      region,
      'total_solved',
      mergeFlags,
      mergePrefs
    );
    all += merged;
    console.log('CRM Jul + Client YTD merged', region, merged);
  }
  console.log('total', all);
}

main().catch(console.error);
