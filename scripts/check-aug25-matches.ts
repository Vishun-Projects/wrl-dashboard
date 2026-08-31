import '@/lib/read-model/bootstrap-env';
import { withClient } from '@/lib/read-model/db';

const EXCLUDED = ['Call is Already Open', 'CCLID Already Exist'];

async function main() {
  await withClient(async (c) => {
    const r = await c.query(
      `SELECT a.id, a.client_ticket_no, a.serial_no, a.call_type, a.outlet_name, a.call_date,
              a.reconciliation_status, a.match_count, a.matched_vtrnno
       FROM athena_failed_calls_normalized a
       WHERE a.call_date::date = '2026-08-25'
         AND NOT EXISTS (SELECT 1 FROM unnest($1::text[]) p WHERE a.failure_reason ILIKE (p || '%'))
       ORDER BY a.id`,
      [EXCLUDED]
    );
    console.log('rows', r.rows.length);
    for (const row of r.rows) {
      const crm = await c.query(
        `SELECT
           COUNT(*)::int AS total_four_way,
           COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(vcclid,''))) = UPPER(TRIM($1)))::int AS same_cclid,
           COUNT(*) FILTER (WHERE UPPER(TRIM(vcclid)) = UPPER(TRIM($1)))::int AS direct_cclid
         FROM calls_latest_hot c
         WHERE UPPER(TRIM(c.call_type)) = UPPER(TRIM($2))
           AND UPPER(TRIM(c.party_name)) = UPPER(TRIM($3))
           AND UPPER(REGEXP_REPLACE(COALESCE(c.serial, ''), '\\s+', '', 'g'))
             = UPPER(REGEXP_REPLACE(COALESCE($4, ''), '\\s+', '', 'g'))
           AND c.logged_at >= $5::timestamptz`,
        [row.client_ticket_no, row.call_type, row.outlet_name, row.serial_no, row.call_date]
      );
      const d = crm.rows[0];
      const wouldRegister =
        d.direct_cclid === 1 ||
        d.same_cclid === 1 ||
        (d.total_four_way === 1 && d.same_cclid <= 1);
      console.log({
        ticket: row.client_ticket_no,
        status: row.reconciliation_status,
        matched: row.matched_vtrnno,
        four_way: d.total_four_way,
        same_cclid: d.same_cclid,
        direct_cclid: d.direct_cclid,
        wouldRegister,
      });
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
