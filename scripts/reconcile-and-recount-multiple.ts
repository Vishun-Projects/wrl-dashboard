import '@/lib/read-model/bootstrap-env';
import { withClient } from '@/lib/read-model/db';
import { executeAthenaReconciliation } from '@/lib/read-model/athena-reconciliation/reconcile';

async function main() {
  const before = await withClient((c) =>
    c.query(
      `SELECT id, client_ticket_no, reconciliation_status, match_count, matched_vtrnnos
       FROM athena_failed_calls_normalized WHERE client_ticket_no = '2671058' LIMIT 1`
    )
  );
  console.log('before', before.rows[0]);

  await executeAthenaReconciliation(undefined, { reprocessAll: true });

  const after = await withClient((c) =>
    c.query(
      `SELECT id, client_ticket_no, reconciliation_status, match_count, matched_vtrnnos
       FROM athena_failed_calls_normalized WHERE client_ticket_no = '2671058' LIMIT 1`
    )
  );
  console.log('after', after.rows[0]);

  const mult = await withClient((c) =>
    c.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM (
        SELECT DISTINCT ON (
          COALESCE(client_ticket_no,''), COALESCE(failure_reason,''),
          COALESCE(serial_no,''), COALESCE(call_type,'')
        ) *
        FROM athena_failed_calls_normalized
        WHERE reconciliation_status = 'MULTIPLE_MATCHES'
          AND call_date >= date_trunc('month', CURRENT_DATE)
          AND call_date < date_trunc('month', CURRENT_DATE) + interval '1 month'
        ORDER BY
          COALESCE(client_ticket_no,''), COALESCE(failure_reason,''),
          COALESCE(serial_no,''), COALESCE(call_type,''),
          id DESC
      ) x`
    )
  );
  console.log('multiple this month after full reprocess:', mult.rows[0]?.cnt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
