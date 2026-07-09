import { prisma } from '@/lib/db/prisma';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';
import { HOT_OFFICE_JOINS_SQL } from '@/lib/read-model/queries/hot-region';
import { DEFAULT_MIS_SOURCE_SELECTION } from '@/lib/mis-client-import/source-selection';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';
import type { UserDigestScope } from '@/lib/mis-email/user-scope';

function buildOfficeClause(
  scope: UserDigestScope,
  startIdx: number
): { clause: string; values: unknown[] } {
  if (scope.isHod || scope.assignedOffices.length === 0) {
    return { clause: '', values: [] };
  }
  return {
    clause: ` AND h.nofficeid = ANY($${startIdx}::bigint[])`,
    values: [scope.assignedOffices.map((id) => Number(id))],
  };
}

export async function queryCrmDigestAccountNames(
  scope: UserDigestScope,
  dateRange: DigestDateRange
): Promise<string[]> {
  const office = buildOfficeClause(scope, 3);
  const values: unknown[] = [
    `${dateRange.startDate}T00:00:00`,
    `${dateRange.endDate}T23:59:59`,
    ...office.values,
  ];

  const rows = await prisma.$queryRawUnsafe<Array<{ account: string }>>(
    `
    SELECT DISTINCT trim(h.account) AS account
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      AND h.account IS NOT NULL
      AND trim(h.account) <> ''
      AND upper(trim(COALESCE(h.call_type, ''))) = 'BREAKDOWN'
      ${office.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    ORDER BY account
    `,
    ...values
  );

  return rows.map((r) => r.account).filter(Boolean);
}

async function queryDistinctClientAccountNames(
  dateRange: DigestDateRange,
  sourceCodes: string[] = DEFAULT_MIS_SOURCE_SELECTION.clientSourceCodes
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ account: string }>>(
    `
    SELECT DISTINCT
      COALESCE(NULLIF(trim(s.crm_account_filter), ''), s.name) AS account
    FROM mis_client_import_rows r
    INNER JOIN mis_client_sources s ON s.id = r.source_id
    WHERE s.code = ANY($3::text[])
      AND r.logged_at >= $1::timestamptz
      AND r.logged_at <= $2::timestamptz
      AND COALESCE(NULLIF(trim(s.crm_account_filter), ''), s.name) IS NOT NULL
    ORDER BY account
    `,
    `${dateRange.startDate}T00:00:00`,
    `${dateRange.endDate}T23:59:59`,
    sourceCodes
  );

  return rows.map((r) => r.account).filter(Boolean);
}

/** Fast DISTINCT account list for the email composer — no full MIS aggregation. */
export async function queryDigestAccountNames(
  scope: UserDigestScope,
  dateRange: DigestDateRange
): Promise<string[]> {
  const [crm, client] = await Promise.all([
    queryCrmDigestAccountNames(scope, dateRange),
    queryDistinctClientAccountNames(dateRange),
  ]);

  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of [...crm, ...client]) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }

  return names.sort((a, b) => a.localeCompare(b));
}
