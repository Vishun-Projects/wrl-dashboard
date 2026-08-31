import '@/lib/read-model/bootstrap-env';
import { withClient } from '@/lib/read-model/db';

async function main() {
  await withClient(async (client) => {
    const idRes = await client.query<{ id: string }>(
      `SELECT id::text FROM athena_failed_calls_normalized WHERE client_ticket_no = '2671058' LIMIT 1`
    );
    const id = idRes.rows[0]?.id;
    if (!id) {
      console.log('no row');
      return;
    }

    const paths = await client.query<{ path: string; vtrnno: string; vcclid: string | null }>(
      `
      SELECT 'p2_cclid' AS path, c.vtrnno, c.vcclid
      FROM athena_failed_calls_normalized a
      JOIN calls_latest_hot c ON UPPER(TRIM(c.vcclid)) = UPPER(TRIM(a.client_ticket_no))
      WHERE a.id = $1

      UNION ALL

      SELECT 'p3_fourway' AS path, c.vtrnno, c.vcclid
      FROM athena_failed_calls_normalized a
      JOIN calls_latest_hot c
        ON UPPER(TRIM(c.call_type)) = UPPER(TRIM(a.call_type))
       AND UPPER(TRIM(c.party_name)) = UPPER(TRIM(a.outlet_name))
       AND UPPER(REGEXP_REPLACE(COALESCE(c.serial, ''), '\\s+', '', 'g')) = UPPER(REGEXP_REPLACE(COALESCE(a.serial_no, ''), '\\s+', '', 'g'))
       AND c.logged_at >= a.call_date
      WHERE a.id = $1 AND a.is_valid_matching_data = true
        AND (
          a.client_ticket_no IS NULL OR TRIM(a.client_ticket_no) IN ('', '0')
          OR UPPER(TRIM(c.vcclid)) = UPPER(TRIM(a.client_ticket_no))
        )

      UNION ALL

      SELECT 'p4_serial_cclid_fail' AS path, c.vtrnno, c.vcclid
      FROM athena_failed_calls_normalized a
      JOIN calls_latest_hot c
        ON UPPER(REGEXP_REPLACE(COALESCE(c.serial, ''), '\\s+', '', 'g')) = UPPER(REGEXP_REPLACE(COALESCE(a.serial_no, ''), '\\s+', '', 'g'))
      WHERE a.id = $1
        AND (a.failure_reason ILIKE '%cclid%' OR a.result_value ILIKE '%cclid%')
        AND (
          a.client_ticket_no IS NULL OR TRIM(a.client_ticket_no) IN ('', '0')
          OR UPPER(TRIM(c.vcclid)) = UPPER(TRIM(a.client_ticket_no))
        )
      `,
      [id]
    );
    console.log('paths for 2671058 id', id);
    console.log(paths.rows);

    // True CCLID duplicates: 2+ CRM rows with same vcclid = ticket
    const trueDup = await client.query<{ cnt: string }>(
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
        ORDER BY
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, ''),
          a.id DESC
      ),
      cclid_counts AS (
        SELECT d.id, d.client_ticket_no, COUNT(c.vtrnno)::int AS cnt
        FROM d
        JOIN calls_latest_hot c
          ON UPPER(TRIM(c.vcclid)) = UPPER(TRIM(d.client_ticket_no))
        WHERE d.client_ticket_no IS NOT NULL AND TRIM(d.client_ticket_no) NOT IN ('', '0')
        GROUP BY d.id, d.client_ticket_no
        HAVING COUNT(c.vtrnno) > 1
      )
      SELECT COUNT(*)::text AS cnt FROM cclid_counts
      `
    );
    console.log('\nTrue ticket=CCLID duplicates this month (should be MULTIPLE):', trueDup.rows[0]?.cnt);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
