import '@/lib/read-model/bootstrap-env';
import { withClient } from '@/lib/read-model/db';

const EXCLUDED = ['Call is Already Open', 'CCLID Already Exist'];

async function main() {
  await withClient(async (client) => {
    const day = await client.query(
      `
      WITH d AS (
        SELECT DISTINCT ON (
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, '')
        ) a.*
        FROM athena_failed_calls_normalized a
        WHERE a.call_date::date = '2026-08-25'
          AND (a.failure_reason IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest($1::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')
          ))
        ORDER BY
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, ''),
          CASE a.reconciliation_status WHEN 'REGISTERED' THEN 0 ELSE 1 END,
          a.id DESC
      )
      SELECT
        reconciliation_status,
        COUNT(*)::int AS cnt
      FROM d
      GROUP BY reconciliation_status
      ORDER BY cnt DESC
      `,
      [EXCLUDED]
    );
    console.log('\n=== Aug 25 status breakdown (deduped) ===');
    console.log(day.rows);

    const mult = await client.query(
      `
      WITH d AS (
        SELECT DISTINCT ON (
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, '')
        ) a.*
        FROM athena_failed_calls_normalized a
        WHERE a.call_date >= date_trunc('month', CURRENT_DATE)
          AND a.call_date < date_trunc('month', CURRENT_DATE) + interval '1 month'
          AND a.reconciliation_status = 'MULTIPLE_MATCHES'
          AND (a.failure_reason IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest($1::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')
          ))
        ORDER BY
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, ''),
          a.id DESC
      )
      SELECT client_ticket_no, call_date::date, failure_reason, match_count, matched_vtrnnos
      FROM d ORDER BY call_date
      `,
      [EXCLUDED]
    );
    console.log('\n=== MULTIPLE_MATCHES this month:', mult.rows.length, '===');
    for (const r of mult.rows) console.log(r);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
