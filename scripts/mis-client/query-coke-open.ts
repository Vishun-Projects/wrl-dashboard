import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import { queryClientAccountSummaryFiltered } from '@/features/mis-import/lib/aggregate';
import { prisma } from '@/lib/db/prisma';

async function main() {
  const summary = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke'],
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
  });

  const cokeOpen = summary.reduce((s, r) => s + r.open_calls, 0);
  const cokeTotal = summary.reduce((s, r) => s + r.total_calls, 0);
  console.log('Aggregate coke open_calls:', cokeOpen, 'total:', cokeTotal);

  const openRows = await prisma.$queryRawUnsafe<
    Array<{ raw_status: string | null; n: number }>
  >(
    `
    SELECT COALESCE(r.raw->>'Call Status', r.raw->>'CallStatus', r.status_label) as raw_status,
           COUNT(*)::int n
    FROM (
      SELECT DISTINCT ON (r.source_id, r.call_key)
        r.status_bucket, r.status_label, r.raw, r.source_id
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code = 'coke' AND b.status = 'completed'
        AND r.logged_at >= '2026-01-01'::date
        AND r.logged_at <= ('2026-06-29'::date + interval '1 day' - interval '1 second')
      ORDER BY r.source_id, r.call_key, b.created_at DESC
    ) r
    WHERE r.status_bucket IN ('assigned', 'open_unallocated')
    GROUP BY 1 ORDER BY n DESC
    `
  );
  console.log('DB open by raw status:', openRows);

  const notSea = await prisma.$queryRawUnsafe<
    Array<{ call_key: string; raw_status: string | null; file_name: string; logged: Date }>
  >(
    `
    SELECT r.call_key,
           COALESCE(r.raw->>'Call Status', r.raw->>'CallStatus') as raw_status,
           b.file_name,
           r.logged_at::date as logged
    FROM (
      SELECT DISTINCT ON (r.source_id, r.call_key)
        r.*, b.file_name, b.created_at as batch_created
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code = 'coke' AND b.status = 'completed'
        AND r.logged_at >= '2026-01-01'::date
        AND r.logged_at <= ('2026-06-29'::date + interval '1 day' - interval '1 second')
        AND r.status_bucket IN ('assigned', 'open_unallocated')
      ORDER BY r.source_id, r.call_key, b.created_at DESC
    ) r
    JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
    WHERE COALESCE(r.raw->>'Call Status', r.raw->>'CallStatus', '') <> 'Service Engg Assigned'
    ORDER BY r.call_key
    `
  );
  console.log('Open NOT Service Engg Assigned:', notSea.length);
  for (const row of notSea) console.log(row);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
