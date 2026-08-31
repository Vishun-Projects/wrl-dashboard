import '@/lib/read-model/bootstrap-env';
import { withClient } from '@/lib/read-model/db';

const EXCLUDED = ['Call is Already Open', 'CCLID Already Exist'];

async function main() {
  await withClient(async (client) => {
    const scope = `
      a.call_date >= '2022-01-01'
      AND a.call_date <= '2026-08-31'::date + interval '1 day'
      AND (a.failure_reason IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest($1::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')
      ))
    `;

    const dedup = `
      SELECT DISTINCT ON (
        COALESCE(a.client_ticket_no, ''),
        COALESCE(a.failure_reason, ''),
        COALESCE(a.serial_no, ''),
        COALESCE(a.call_type, '')
      ) a.*
      FROM athena_failed_calls_normalized a
      WHERE ${scope}
      ORDER BY
        COALESCE(a.client_ticket_no, ''),
        COALESCE(a.failure_reason, ''),
        COALESCE(a.serial_no, ''),
        COALESCE(a.call_type, ''),
        CASE a.reconciliation_status WHEN 'REGISTERED' THEN 0 ELSE 1 END,
        a.id DESC
    `;

    const breakdown = await client.query<{ bucket: string; cnt: string }>(
      `
      WITH d AS (${dedup})
      SELECT
        CASE
          WHEN d.reconciliation_status <> 'NOT_REGISTERED' THEN d.reconciliation_status
          WHEN d.client_ticket_no IS NULL OR TRIM(d.client_ticket_no) IN ('', '0') THEN 'unreg_no_ticket'
          WHEN EXISTS (
            SELECT 1 FROM calls_latest_hot c
            WHERE UPPER(TRIM(c.vcclid)) = UPPER(TRIM(d.client_ticket_no))
          ) THEN 'unreg_ticket_has_crm_cclid'
          ELSE 'unreg_no_crm_for_ticket'
        END AS bucket,
        COUNT(*)::text AS cnt
      FROM d
      GROUP BY 1
      ORDER BY 2::int DESC
      `,
      [EXCLUDED]
    );

    console.log('\n=== Unregistered breakdown (why still NOT_REGISTERED?) ===');
    for (const r of breakdown.rows) console.log(`  ${r.bucket}: ${r.cnt}`);

    const augMatrix = await client.query<{ cnt: string }>(
      `
      WITH d AS (${dedup})
      SELECT COUNT(*)::text AS cnt FROM d
      WHERE d.reconciliation_status = 'NOT_REGISTERED'
        AND d.call_date >= '2026-08-17'
        AND d.call_date < '2026-09-01'::date
        AND EXTRACT(DOW FROM d.call_date::date) <> 0
      `,
      [EXCLUDED]
    );
    console.log('\n=== Aug 17–31 unregistered (deduped, excl Sun):', augMatrix.rows[0]?.cnt);

    const samples = await client.query(
      `
      WITH d AS (${dedup})
      SELECT d.client_ticket_no, d.call_date::date, d.failure_reason, d.serial_no, d.outlet_name
      FROM d
      WHERE d.reconciliation_status = 'NOT_REGISTERED'
      ORDER BY d.call_date DESC
      LIMIT 5
      `,
      [EXCLUDED]
    );
    console.log('\n=== Sample latest unregistered rows ===');
    for (const r of samples.rows) console.log(r);

    const wouldOldMatch = await client.query<{ cnt: string }>(
      `
      WITH d AS (${dedup})
      SELECT COUNT(*)::text AS cnt
      FROM d d
      WHERE d.reconciliation_status = 'NOT_REGISTERED'
        AND EXISTS (
          SELECT 1 FROM calls_latest_hot c
          WHERE UPPER(TRIM(c.call_type)) = UPPER(TRIM(d.call_type))
            AND UPPER(TRIM(c.party_name)) = UPPER(TRIM(d.outlet_name))
            AND UPPER(REGEXP_REPLACE(COALESCE(c.serial, ''), '\\s+', '', 'g'))
              = UPPER(REGEXP_REPLACE(COALESCE(d.serial_no, ''), '\\s+', '', 'g'))
            AND c.logged_at >= d.call_date
        )
      `,
      [EXCLUDED]
    );
    console.log(
      '\n=== NOT_REGISTERED but WOULD match old broad serial rule (no CCLID required):',
      wouldOldMatch.rows[0]?.cnt
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
