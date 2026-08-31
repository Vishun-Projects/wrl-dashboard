import '@/lib/read-model/bootstrap-env';
import {
  fetchAthenaReconciliationSummary,
  fetchAthenaReasonDateMatrix,
} from '@/lib/read-model/athena-reconciliation';

const RULES = {
  treatAsRegisteredReasons: ['Call is Already Open', 'CCLID Already Exist'],
  excludedReasons: ['Call is Already Open', 'CCLID Already Exist'],
};

async function main() {
  const fullRange = {
    startDate: '2022-01-01',
    endDate: '2026-08-31',
    ...RULES,
  };

  const matrixWindow = {
    startDate: '2022-01-01',
    endDate: '2026-08-31',
    ...RULES,
  };

  const [summary, matrix] = await Promise.all([
    fetchAthenaReconciliationSummary(fullRange),
    fetchAthenaReasonDateMatrix(matrixWindow, { start: '2026-08-17', end: '2026-08-31' }),
  ]);

  const k = summary.kpis;
  console.log('\n=== KPI date range 2022-01-01 → 2026-08-31 (excluded: Call is Already Open, CCLID Already Exist) ===');
  console.log({
    total: k.totalRecords,
    registered: k.registered,
    unregistered: k.notRegistered,
    multiple: k.multipleMatches,
    invalid: k.invalidData,
    sum: k.registered + k.notRegistered + k.multipleMatches + k.invalidData,
  });

  console.log('\n=== Matrix window 2026-08-17 → 2026-08-31 (Mon–Sat) ===');
  console.log({
    grandTotal: matrix.grandTotal,
    registered: matrix.registeredTotal,
    unregistered: matrix.unregisteredTotal,
    multiple: matrix.multipleMatchesTotal,
    invalid: matrix.invalidDataTotal,
    sum:
      matrix.registeredTotal +
      matrix.unregisteredTotal +
      matrix.multipleMatchesTotal +
      matrix.invalidDataTotal,
  });

  console.log('\n=== Top failure reasons (unregistered only, full range) ===');
  const top = summary.byFailureReason
    .filter((r) => r.label && !RULES.excludedReasons.some((e) => r.label.startsWith(e)))
    .slice(0, 8)
    .map((r) => ({ reason: r.label, count: r.count }));
  console.log(top);

  console.log('\n=== Raw DB status (no treat-as-registered, same date + exclusions) ===');
  const { withClient } = await import('@/lib/read-model/db');
  await withClient(async (client) => {
    const raw = await client.query<{
      status: string;
      cnt: string;
    }>(
      `
      SELECT a.reconciliation_status AS status, COUNT(*)::text AS cnt
      FROM (
        SELECT DISTINCT ON (
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, '')
        ) a.reconciliation_status
        FROM athena_failed_calls_normalized a
        WHERE a.call_date >= '2022-01-01'
          AND a.call_date <= '2026-08-31'::date + interval '1 day'
          AND (a.failure_reason IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest($1::text[]) AS p
            WHERE a.failure_reason ILIKE (p || '%')
          ))
        ORDER BY
          COALESCE(a.client_ticket_no, ''),
          COALESCE(a.failure_reason, ''),
          COALESCE(a.serial_no, ''),
          COALESCE(a.call_type, ''),
          CASE a.reconciliation_status WHEN 'REGISTERED' THEN 0 ELSE 1 END,
          a.id DESC
      ) a
      GROUP BY a.reconciliation_status
      ORDER BY cnt DESC
      `,
      [RULES.excludedReasons]
    );
    for (const row of raw.rows) {
      console.log(`  ${row.status}: ${row.cnt}`);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
