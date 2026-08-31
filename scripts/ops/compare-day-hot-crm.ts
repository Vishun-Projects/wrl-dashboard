/**
 * Compare one logged day: hot vs CRM BREAKDOWN counts.
 *   npx tsx scripts/ops/compare-day-hot-crm.ts 2026-08-28
 */
import '@/modules/mis-email/services/bootstrap-env';
import { postQuery } from '@/lib/db/proxy';
import { withAppClient, closePool } from '@/lib/read-model/db';

const day = process.argv[2]?.trim() || '2026-08-28';

async function main() {
  const hot = await withAppClient(async (c) => {
    const total = await c.query(
      `SELECT count(*)::bigint AS n FROM calls_latest_hot
       WHERE upper(trim(call_type)) = 'BREAKDOWN'
         AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`,
      [day]
    );
    const buckets = await c.query(
      `SELECT status_bucket, count(*)::bigint AS n FROM calls_latest_hot
       WHERE upper(trim(call_type)) = 'BREAKDOWN'
         AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
       GROUP BY status_bucket ORDER BY status_bucket`,
      [day]
    );
    return { total: Number(total.rows[0]?.n ?? 0), buckets: buckets.rows };
  });

  const crm = await postQuery({
    rawSql: `
      SELECT COUNT(DISTINCT LTRIM(RTRIM(tc.vtrnno))) AS cnt
      FROM trhcalls tc (NOLOCK)
      INNER JOIN mstfixedselection calltype_fs (NOLOCK)
        ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
      WHERE tc.dtrndate >= '${day}' AND tc.dtrndate <= '${day} 23:59:59'
        AND tc.vtrnno IS NOT NULL AND LTRIM(RTRIM(tc.vtrnno)) <> ''
        AND ISNULL(tc.vtransfercallno, '') = ''
        AND ISNULL(CAST(tc.ncancelreason AS INT), 0) <> 2
        AND UPPER(LTRIM(RTRIM(calltype_fs.vdisplayvalue))) = 'BREAKDOWN'
    `,
    timeoutMs: 120_000,
  });
  const crmTotal = Number((crm.data?.[0] as { cnt?: string })?.cnt ?? 0);

  console.log(`=== BREAKDOWN logged ${day} (IST) ===`);
  console.log(`CRM:  ${crmTotal.toLocaleString('en-IN')}`);
  console.log(`Hot:  ${hot.total.toLocaleString('en-IN')}`);
  console.log(`Gap:  ${hot.total - crmTotal >= 0 ? '+' : ''}${(hot.total - crmTotal).toLocaleString('en-IN')}`);
  console.log('Hot status_bucket:');
  for (const b of hot.buckets) {
    console.log(`  ${String(b.status_bucket).padEnd(18)} ${Number(b.n).toLocaleString('en-IN')}`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
