import '@/lib/read-model/bootstrap-env';
import { withClient } from '@/lib/read-model/db';

const EXCLUDED = ['Call is Already Open', 'CCLID Already Exist'];

async function main() {
  await withClient(async (client) => {
    const rows = await client.query<{
      id: string;
      client_ticket_no: string;
      call_date: string;
      failure_reason: string;
      match_count: string;
      matched_vtrnno: string;
      matched_vtrnnos: string[];
      serial_no: string;
      outlet_name: string;
    }>(
      `
      WITH d AS (
        SELECT DISTINCT ON (
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, '')
        ) a.*
        FROM athena_failed_calls_normalized a
        WHERE a.reconciliation_status = 'MULTIPLE_MATCHES'
          AND a.call_date >= date_trunc('month', CURRENT_DATE)
          AND a.call_date < date_trunc('month', CURRENT_DATE) + interval '1 month'
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
      SELECT
        d.id::text,
        d.client_ticket_no,
        d.call_date::date::text,
        d.failure_reason,
        d.match_count::text,
        d.matched_vtrnno,
        d.matched_vtrnnos,
        d.serial_no,
        d.outlet_name
      FROM d
      ORDER BY d.call_date DESC, d.client_ticket_no
      `,
      [EXCLUDED]
    );

    console.log(`\n=== MULTIPLE_MATCHES this month: ${rows.rows.length} ===\n`);

    for (const r of rows.rows) {
      const crm = await client.query<{
        vtrnno: string;
        vcclid: string | null;
        logged_at: string;
        status_label: string | null;
        party_name: string | null;
        serial: string | null;
      }>(
        `
        SELECT vtrnno, vcclid, logged_at::text, status_label, party_name, serial
        FROM calls_latest_hot
        WHERE vtrnno = ANY($1::text[])
        ORDER BY logged_at ASC
        `,
        [r.matched_vtrnnos ?? []]
      );

      console.log('---');
      console.log({
        ticket: r.client_ticket_no,
        date: r.call_date,
        reason: r.failure_reason,
        serial: r.serial_no,
        outlet: r.outlet_name,
        matchCount: r.match_count,
        matchedTrns: r.matched_vtrnnos,
      });
      console.log('CRM rows:');
      for (const c of crm.rows) {
        console.log(
          `  ${c.vtrnno} | CCLID=${c.vcclid ?? '—'} | ${c.logged_at.slice(0, 10)} | ${c.status_label} | ${c.party_name}`
        );
      }
      const cclids = [...new Set(crm.rows.map((c) => c.vcclid?.trim()).filter(Boolean))];
      const sameCclid = cclids.length === 1 && cclids[0] === r.client_ticket_no?.trim();
      console.log(`  → same ticket=CCLID for all matches? ${sameCclid ? 'YES' : 'NO'} (cclids: ${cclids.join(', ') || 'none'})`);
    }

    // Also check: would OLD broad serial rule have produced more multiples?
    const oldStyle = await client.query<{ cnt: string }>(
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
          AND (a.failure_reason IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest($1::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')
          ))
        ORDER BY
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, ''),
          a.id DESC
      ),
      broad AS (
        SELECT d.id, COUNT(c.vtrnno)::int AS cnt
        FROM d
        JOIN calls_latest_hot c
          ON UPPER(TRIM(c.call_type)) = UPPER(TRIM(d.call_type))
         AND UPPER(TRIM(c.party_name)) = UPPER(TRIM(d.outlet_name))
         AND UPPER(REGEXP_REPLACE(COALESCE(c.serial, ''), '\\s+', '', 'g'))
           = UPPER(REGEXP_REPLACE(COALESCE(d.serial_no, ''), '\\s+', '', 'g'))
         AND c.logged_at >= d.call_date
        GROUP BY d.id
        HAVING COUNT(c.vtrnno) > 1
      )
      SELECT COUNT(*)::text AS cnt FROM broad
      `,
      [EXCLUDED]
    );
    console.log(`\n=== Old broad serial rule would flag ${oldStyle.rows[0]?.cnt} as multiple this month ===`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
