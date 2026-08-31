import { withClient } from '@/lib/read-model/db';
import { formatLocalDate } from '@/lib/dates/local-date';
import type {
  AthenaBreakdownItem,
  AthenaDailyTrendPoint,
  AthenaProblemEntity,
  AthenaReconciliationFilterParams,
  AthenaReconciliationKpis,
  AthenaReconciliationSummary,
  AthenaReasonDateMatrix,
} from './types';

interface FacetedFilterOptions {
  omitField?: 'branch' | 'client' | 'callType' | 'failureReason';
  applyStatus?: boolean;
}

function toList(val?: string | string[] | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((v) => Boolean(v) && v !== 'All');
  if (val === 'All') return [];
  return [val];
}

/** Unregistered + legacy multiple-match rows (latter folded into unregistered in UI). */
function unregisteredStatusSql(alias: string, hasTreat: boolean, treatParamIdx: number): string {
  const status = `${alias}.reconciliation_status IN ('NOT_REGISTERED', 'MULTIPLE_MATCHES')`;
  if (!hasTreat) return `(${status})`;
  return `(${status} AND NOT EXISTS (SELECT 1 FROM unnest($${treatParamIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')))`;
}

function buildBaseFacetedConditions(
  params: AthenaReconciliationFilterParams,
  options: FacetedFilterOptions = {},
  alias = 'a'
): {
  conditions: string[];
  values: unknown[];
} {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (params.startDate) {
    conditions.push(`${alias}.call_date >= $${paramIdx++}`);
    values.push(params.startDate);
  }
  if (params.endDate) {
    conditions.push(`${alias}.call_date <= $${paramIdx++}::date + interval '1 day'`);
    values.push(params.endDate);
  }

  const branchList = toList(params.branches || params.branch);
  if (options.omitField !== 'branch' && branchList.length > 0) {
    conditions.push(`${alias}.branch_name = ANY($${paramIdx++}::text[])`);
    values.push(branchList);
  }

  const clientList = toList(params.clients || params.client);
  if (options.omitField !== 'client' && clientList.length > 0) {
    conditions.push(`${alias}.client_caption = ANY($${paramIdx++}::text[])`);
    values.push(clientList);
  }

  const callTypeList = toList(params.callTypes || params.callType);
  if (options.omitField !== 'callType' && callTypeList.length > 0) {
    conditions.push(`${alias}.call_type = ANY($${paramIdx++}::text[])`);
    values.push(callTypeList);
  }

  const reasonList = toList(params.failureReasons || params.failureReason);
  if (options.omitField !== 'failureReason' && reasonList.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM unnest($${paramIdx++}::text[]) AS r
      WHERE ${alias}.failure_reason = r
         OR ${alias}.failure_reason ILIKE (r || '%')
    )`);
    values.push(reasonList);
  }

  const excludedList = toList(params.excludedReasons);
  if (excludedList.length > 0) {
    conditions.push(`(${alias}.failure_reason IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest($${paramIdx++}::text[]) AS p
      WHERE ${alias}.failure_reason ILIKE (p || '%')
    ))`);
    values.push(excludedList);
  }

  // If applying status filter
  if (options.applyStatus && params.status && params.status !== 'ALL') {
    const treatList = toList(params.treatAsRegisteredReasons);
    const hasTreat = treatList.length > 0;

    if (hasTreat) {
      const treatIdx = paramIdx++;
      values.push(treatList);

      if (params.status === 'REGISTERED') {
        conditions.push(
          `(${alias}.reconciliation_status = 'REGISTERED' OR EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')) )`
        );
      } else {
        const statusIdx = paramIdx++;
        values.push(params.status);
        conditions.push(
          `(${alias}.reconciliation_status = $${statusIdx} AND NOT EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')) )`
        );
      }
    } else {
      const statusIdx = paramIdx++;
      values.push(params.status);
      conditions.push(`${alias}.reconciliation_status = $${statusIdx}`);
    }
  }

  return { conditions, values };
}

function dedupSubquery(whereClause: string): string {
  return `(
    SELECT DISTINCT ON (
      COALESCE(a.client_ticket_no, ''),
      COALESCE(a.failure_reason, ''),
      COALESCE(a.serial_no, ''),
      COALESCE(a.call_type, '')
    ) a.*
    FROM athena_failed_calls_normalized a
    WHERE ${whereClause}
    ORDER BY
      COALESCE(a.client_ticket_no, ''),
      COALESCE(a.failure_reason, ''),
      COALESCE(a.serial_no, ''),
      COALESCE(a.call_type, ''),
      CASE a.reconciliation_status WHEN 'REGISTERED' THEN 0 ELSE 1 END,
      a.id DESC
  ) a`;
}

export async function fetchAthenaReconciliationSummary(
  params: AthenaReconciliationFilterParams = {}
): Promise<AthenaReconciliationSummary> {
  return withClient(async (client) => {
    const treatList = toList(params.treatAsRegisteredReasons);
    const hasTreat = treatList.length > 0;

    // 1. Executive KPIs (calculated across all statuses for current filter scope)
    const { conditions: kpiConds, values: baseKpiValues } =
      buildBaseFacetedConditions(params, { applyStatus: false }, 'a');
    const kpiWhere = kpiConds.join(' AND ');
    const kpiValues = hasTreat ? [...baseKpiValues, treatList] : baseKpiValues;
    const treatIdx = hasTreat ? kpiValues.length : -1;

    const regCond = hasTreat
      ? `(a.reconciliation_status = 'REGISTERED' OR EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'REGISTERED')`;
    const notRegCond = unregisteredStatusSql('a', hasTreat, treatIdx);
    const invCond = hasTreat
      ? `(a.reconciliation_status = 'INVALID_DATA' AND NOT EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'INVALID_DATA')`;

    const kpiRes = await client.query<{
      total_records: string;
      registered: string;
      not_registered: string;
      invalid_data: string;
    }>(
      `
      SELECT
        COUNT(*)::text AS total_records,
        COUNT(*) FILTER (WHERE ${regCond})::text AS registered,
        COUNT(*) FILTER (WHERE ${notRegCond})::text AS not_registered,
        COUNT(*) FILTER (WHERE ${invCond})::text AS invalid_data
      FROM ${dedupSubquery(kpiWhere)}
      `,
      kpiValues
    );

    const kpiRow = kpiRes.rows[0] ?? {
      total_records: '0',
      registered: '0',
      not_registered: '0',
      invalid_data: '0',
    };

    const totalRecords = parseInt(kpiRow.total_records, 10) || 0;
    const registered = parseInt(kpiRow.registered, 10) || 0;
    const notRegistered = parseInt(kpiRow.not_registered, 10) || 0;
    const invalidData = parseInt(kpiRow.invalid_data, 10) || 0;

    const registrationRatePct = totalRecords > 0 ? Number(((registered / totalRecords) * 100).toFixed(1)) : 0;
    const failureRatePct = totalRecords > 0 ? Number(((notRegistered / totalRecords) * 100).toFixed(1)) : 0;

    const kpis: AthenaReconciliationKpis = {
      totalRecords,
      registered,
      notRegistered,
      multipleMatches: 0,
      invalidData,
      registrationRatePct,
      failureRatePct,
    };

    // 2. Daily Trend
    const { conditions: trendConds, values: baseTrendValues } =
      buildBaseFacetedConditions(params, { applyStatus: false }, 'a');
    const trendWhere = trendConds.join(' AND ');
    const trendValues = hasTreat ? [...baseTrendValues, treatList] : baseTrendValues;
    const trendTreatIdx = hasTreat ? trendValues.length : -1;

    const trendRegCond = hasTreat
      ? `(a.reconciliation_status = 'REGISTERED' OR EXISTS (SELECT 1 FROM unnest($${trendTreatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'REGISTERED')`;
    const trendNotRegCond = unregisteredStatusSql('a', hasTreat, trendTreatIdx);
    const trendInvCond = hasTreat
      ? `(a.reconciliation_status = 'INVALID_DATA' AND NOT EXISTS (SELECT 1 FROM unnest($${trendTreatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'INVALID_DATA')`;

    const trendRes = await client.query<{
      date_str: string;
      total: string;
      registered: string;
      not_registered: string;
      invalid_data: string;
    }>(
      `
      SELECT * FROM (
        SELECT
          TO_CHAR(COALESCE(a.call_date, a.addedon_at), 'YYYY-MM-DD') AS date_str,
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE ${trendRegCond})::text AS registered,
          COUNT(*) FILTER (WHERE ${trendNotRegCond})::text AS not_registered,
          COUNT(*) FILTER (WHERE ${trendInvCond})::text AS invalid_data
        FROM ${dedupSubquery(trendWhere)}
        WHERE a.call_date IS NOT NULL OR a.addedon_at IS NOT NULL
        GROUP BY date_str
        ORDER BY date_str DESC
        LIMIT 60
      ) sub
      ORDER BY date_str ASC
      `,
      trendValues
    );

    const dailyTrend: AthenaDailyTrendPoint[] = trendRes.rows.map((r) => ({
      date: r.date_str,
      total: parseInt(r.total, 10) || 0,
      registered: parseInt(r.registered, 10) || 0,
      notRegistered: parseInt(r.not_registered, 10) || 0,
      multipleMatches: 0,
      invalidData: parseInt(r.invalid_data, 10) || 0,
    }));

    // 3. Breakdown by Failure Reason (Faceted: omit failureReason so all options remain available; apply status)
    const { conditions: reasonConds, values: reasonValues } =
      buildBaseFacetedConditions(params, { omitField: 'failureReason', applyStatus: true }, 'a');
    const reasonWhere = reasonConds.join(' AND ');

    const reasonRes = await client.query<{
      label: string;
      count: string;
    }>(
      `
      SELECT
        CASE
          WHEN a.failure_reason ILIKE 'Call is Already Open%' THEN 'Call is Already Open'
          WHEN a.failure_reason ILIKE 'Different Party Profile%' THEN 'Different Party Profile'
          ELSE COALESCE(TRIM(TRAILING '.' FROM a.failure_reason), 'Unknown')
        END AS label,
        COUNT(*)::text AS count
      FROM ${dedupSubquery(reasonWhere)}
      GROUP BY label
      ORDER BY COUNT(*) DESC
      LIMIT 35
      `,
      reasonValues
    );

    // Contextual total for calculating percentage of the active status
    const statusTotal =
      params.status === 'REGISTERED'
        ? registered
        : params.status === 'NOT_REGISTERED' || params.status === 'MULTIPLE_MATCHES'
        ? notRegistered
        : totalRecords;

    const byFailureReason: AthenaBreakdownItem[] = reasonRes.rows.map((r) => {
      const c = parseInt(r.count, 10) || 0;
      return {
        label: r.label,
        count: c,
        percentage: statusTotal > 0 ? Number(((c / statusTotal) * 100).toFixed(1)) : 0,
      };
    });

    // 4. Breakdown by Call Type (Faceted: omit callType so all call types remain available)
    const { conditions: typeConds, values: typeValues } =
      buildBaseFacetedConditions(params, { omitField: 'callType', applyStatus: true }, 'a');
    const typeWhere = typeConds.join(' AND ');

    const typeRes = await client.query<{
      label: string;
      count: string;
    }>(
      `
      SELECT
        COALESCE(a.call_type, 'Unspecified') AS label,
        COUNT(*)::text AS count
      FROM ${dedupSubquery(typeWhere)}
      GROUP BY label
      ORDER BY COUNT(*) DESC
      LIMIT 20
      `,
      typeValues
    );

    const byCallType: AthenaBreakdownItem[] = typeRes.rows.map((r) => {
      const c = parseInt(r.count, 10) || 0;
      return {
        label: r.label,
        count: c,
        percentage: statusTotal > 0 ? Number(((c / statusTotal) * 100).toFixed(1)) : 0,
      };
    });

    // 5. Breakdown by Client (Faceted: omit client so all clients remain available)
    const { conditions: clientConds, values: clientValues } =
      buildBaseFacetedConditions(params, { omitField: 'client', applyStatus: true }, 'a');
    const clientWhere = clientConds.join(' AND ');

    const clientRes = await client.query<{
      label: string;
      count: string;
    }>(
      `
      SELECT
        COALESCE(a.client_caption, 'Unassigned') AS label,
        COUNT(*)::text AS count
      FROM ${dedupSubquery(clientWhere)}
      GROUP BY label
      ORDER BY COUNT(*) DESC
      LIMIT 80
      `,
      clientValues
    );

    const byClient: AthenaBreakdownItem[] = clientRes.rows.map((r) => {
      const c = parseInt(r.count, 10) || 0;
      return {
        label: r.label,
        count: c,
        percentage: statusTotal > 0 ? Number(((c / statusTotal) * 100).toFixed(1)) : 0,
      };
    });

    // 6. Breakdown by Branch (Faceted: omit branch so all branches remain available)
    const { conditions: branchConds, values: branchValues } =
      buildBaseFacetedConditions(params, { omitField: 'branch', applyStatus: true }, 'a');
    const branchWhere = branchConds.join(' AND ');

    const branchRes = await client.query<{
      label: string;
      count: string;
    }>(
      `
      SELECT
        COALESCE(a.branch_name, 'Unassigned') AS label,
        COUNT(*)::text AS count
      FROM ${dedupSubquery(branchWhere)}
      GROUP BY label
      ORDER BY COUNT(*) DESC
      LIMIT 80
      `,
      branchValues
    );

    const byBranch: AthenaBreakdownItem[] = branchRes.rows.map((r) => {
      const c = parseInt(r.count, 10) || 0;
      return {
        label: r.label,
        count: c,
        percentage: statusTotal > 0 ? Number(((c / statusTotal) * 100).toFixed(1)) : 0,
      };
    });

    // 7. Top 10 Problem Serials (strictly NOT_REGISTERED after pattern exclusions)
    const { conditions: serialsConds, values: baseSerialsValues } =
      buildBaseFacetedConditions(params, { applyStatus: false }, 'a');
    const serialsWhere = serialsConds.join(' AND ');
    const serialsValues = hasTreat ? [...baseSerialsValues, treatList] : baseSerialsValues;
    const serialsTreatIdx = hasTreat ? serialsValues.length : -1;
    const serialsNotRegCond = hasTreat
      ? `(a.reconciliation_status = 'NOT_REGISTERED' AND NOT EXISTS (SELECT 1 FROM unnest($${serialsTreatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'NOT_REGISTERED')`;

    const serialsRes = await client.query<{
      serial_no: string;
      client_caption: string | null;
      total_unregistered: string;
      latest_call_date: string | null;
      common_failure_reason: string | null;
    }>(
      `
      SELECT
        a.serial_no,
        MAX(a.client_caption) AS client_caption,
        COUNT(*)::text AS total_unregistered,
        TO_CHAR(MAX(a.call_date), 'YYYY-MM-DD') AS latest_call_date,
        (ARRAY_AGG(a.failure_reason ORDER BY a.call_date DESC))[1] AS common_failure_reason
      FROM ${dedupSubquery(`${serialsWhere} AND ${serialsNotRegCond}`)}
      WHERE a.serial_no IS NOT NULL AND a.serial_no <> ''
      GROUP BY a.serial_no
      ORDER BY COUNT(*) DESC
      LIMIT 10
      `,
      serialsValues
    );

    const topUnregisteredSerials: AthenaProblemEntity[] = serialsRes.rows.map((r) => ({
      identifier: r.serial_no,
      name: r.client_caption ? `${r.serial_no} (${r.client_caption})` : r.serial_no,
      totalUnregistered: parseInt(r.total_unregistered, 10) || 0,
      latestCallDate: r.latest_call_date,
      commonFailureReason: r.common_failure_reason,
    }));

    // 8. Top 10 Problem Outlets (strictly NOT_REGISTERED after pattern exclusions)
    const { conditions: outletsConds, values: baseOutletsValues } =
      buildBaseFacetedConditions(params, { applyStatus: false }, 'a');
    const outletsWhere = outletsConds.join(' AND ');
    const outletsValues = hasTreat ? [...baseOutletsValues, treatList] : baseOutletsValues;
    const outletsTreatIdx = hasTreat ? outletsValues.length : -1;
    const outletsNotRegCond = hasTreat
      ? `(a.reconciliation_status = 'NOT_REGISTERED' AND NOT EXISTS (SELECT 1 FROM unnest($${outletsTreatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'NOT_REGISTERED')`;

    const outletsRes = await client.query<{
      outlet_name: string;
      branch_name: string | null;
      total_unregistered: string;
      latest_call_date: string | null;
      common_failure_reason: string | null;
    }>(
      `
      SELECT
        a.outlet_name,
        MAX(a.branch_name) AS branch_name,
        COUNT(*)::text AS total_unregistered,
        TO_CHAR(MAX(a.call_date), 'YYYY-MM-DD') AS latest_call_date,
        (ARRAY_AGG(a.failure_reason ORDER BY a.call_date DESC))[1] AS common_failure_reason
      FROM ${dedupSubquery(`${outletsWhere} AND ${outletsNotRegCond}`)}
      WHERE a.outlet_name IS NOT NULL AND a.outlet_name <> ''
      GROUP BY a.outlet_name
      ORDER BY COUNT(*) DESC
      LIMIT 10
      `,
      outletsValues
    );

    const topUnregisteredOutlets: AthenaProblemEntity[] = outletsRes.rows.map((r) => ({
      identifier: r.outlet_name,
      name: r.branch_name ? `${r.outlet_name} (${r.branch_name})` : r.outlet_name,
      totalUnregistered: parseInt(r.total_unregistered, 10) || 0,
      latestCallDate: r.latest_call_date,
      commonFailureReason: r.common_failure_reason,
    }));

    // 9. Sync State & Metadata
    const syncRes = await client.query<{
      status: string | null;
      last_addedon: string | null;
      last_run_at: string | null;
      rows_upserted_last: number | null;
    }>(
      `
      SELECT status, last_addedon, last_run_at, rows_upserted_last
      FROM sync_state
      WHERE entity = 'athena_failed_calls'
      LIMIT 1
      `
    );

    const lastSyncState = syncRes.rows[0]
      ? {
          status: syncRes.rows[0].status,
          lastAddedon: syncRes.rows[0].last_addedon,
          lastRunAt: syncRes.rows[0].last_run_at,
          rowsUpsertedLast: syncRes.rows[0].rows_upserted_last || 0,
        }
      : null;

    // 10. Last Reconciled Timestamp
    const lastRecRes = await client.query<{ max_rec: string | null }>(
      `SELECT MAX(reconciled_at)::text AS max_rec FROM athena_failed_calls_normalized`
    );
    const lastReconciledAt = lastRecRes.rows[0]?.max_rec || null;

    return {
      kpis,
      dailyTrend,
      byFailureReason,
      byCallType,
      byClient,
      byBranch,
      topUnregisteredSerials,
      topUnregisteredOutlets,
      lastReconciledAt,
      lastSyncState,
    };
  });
}

function normalizeFailureReasonLabel(raw: string | null): string {
  if (!raw) return 'Unknown';
  if (raw.toLowerCase().startsWith('call is already open')) return 'Call is Already Open';
  if (raw.toLowerCase().startsWith('different party profile')) return 'Different Party Profile';
  return raw.replace(/\.$/, '').trim() || 'Unknown';
}

function isSundayIsoDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 0;
}

function listIsoDatesInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    const iso = formatLocalDate(cur);
    if (!isSundayIsoDate(iso)) dates.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Failure reason × call-date counts for a fixed window (typically 15 days). */
export async function fetchAthenaReasonDateMatrix(
  params: AthenaReconciliationFilterParams,
  window: { start: string; end: string }
): Promise<AthenaReasonDateMatrix> {
  const dates = listIsoDatesInclusive(window.start, window.end);
  const matrixParams: AthenaReconciliationFilterParams = {
    ...params,
    startDate: window.start,
    endDate: window.end,
    failureReason: null,
    failureReasons: [],
    status: 'ALL',
  };

  return withClient(async (client) => {
    const treatList = toList(params.treatAsRegisteredReasons);
    const hasTreat = treatList.length > 0;

    const { conditions, values } = buildBaseFacetedConditions(
      matrixParams,
      { omitField: 'failureReason', applyStatus: false },
      'a'
    );
    const where = conditions.join(' AND ');
    const statusValues = hasTreat ? [...values, treatList] : values;
    const treatIdx = hasTreat ? statusValues.length : -1;

    const regCond = hasTreat
      ? `(a.reconciliation_status = 'REGISTERED' OR EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'REGISTERED')`;
    const notRegCond = unregisteredStatusSql('a', hasTreat, treatIdx);
    const invCond = hasTreat
      ? `(a.reconciliation_status = 'INVALID_DATA' AND NOT EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')))`
      : `(a.reconciliation_status = 'INVALID_DATA')`;

    const [res, statusRes] = await Promise.all([
      client.query<{ reason: string; day: string; count: string }>(
        `
      SELECT
        CASE
          WHEN a.failure_reason ILIKE 'Call is Already Open%' THEN 'Call is Already Open'
          WHEN a.failure_reason ILIKE 'Different Party Profile%' THEN 'Different Party Profile'
          ELSE COALESCE(TRIM(TRAILING '.' FROM a.failure_reason), 'Unknown')
        END AS reason,
        TO_CHAR(a.call_date::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::text AS count
      FROM ${dedupSubquery(`${where} AND a.call_date IS NOT NULL`)}
      GROUP BY reason, day
      ORDER BY reason ASC, day ASC
      `,
        values
      ),
      client.query<{
        day: string;
        registered: string;
        not_registered: string;
        invalid_data: string;
      }>(
        `
      SELECT
        TO_CHAR(a.call_date::date, 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE ${regCond})::text AS registered,
        COUNT(*) FILTER (WHERE ${notRegCond})::text AS not_registered,
        COUNT(*) FILTER (WHERE ${invCond})::text AS invalid_data
      FROM ${dedupSubquery(`${where} AND a.call_date IS NOT NULL`)}
      GROUP BY day
      ORDER BY day ASC
      `,
        statusValues
      ),
    ]);

    const byReason = new Map<string, { total: number; byDate: Record<string, number> }>();
    const columnTotals: Record<string, number> = Object.fromEntries(dates.map((d) => [d, 0]));
    let grandTotal = 0;

    for (const row of res.rows) {
      const reason = normalizeFailureReasonLabel(row.reason);
      const day = row.day;
      const count = parseInt(row.count, 10) || 0;
      if (!dates.includes(day)) continue;
      const entry = byReason.get(reason) ?? { total: 0, byDate: {} };
      entry.byDate[day] = (entry.byDate[day] ?? 0) + count;
      entry.total += count;
      byReason.set(reason, entry);
      columnTotals[day] = (columnTotals[day] ?? 0) + count;
      grandTotal += count;
    }

    const rows = [...byReason.entries()]
      .map(([reason, data]) => ({ reason, total: data.total, byDate: data.byDate }))
      .sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));

    const registeredByDate: Record<string, number> = Object.fromEntries(dates.map((d) => [d, 0]));
    const unregisteredByDate: Record<string, number> = Object.fromEntries(dates.map((d) => [d, 0]));
    const invalidDataByDate: Record<string, number> = Object.fromEntries(dates.map((d) => [d, 0]));
    let registeredTotal = 0;
    let unregisteredTotal = 0;
    let invalidDataTotal = 0;

    for (const row of statusRes.rows) {
      if (!dates.includes(row.day)) continue;
      const reg = parseInt(row.registered, 10) || 0;
      const unreg = parseInt(row.not_registered, 10) || 0;
      const inv = parseInt(row.invalid_data, 10) || 0;
      registeredByDate[row.day] = reg;
      unregisteredByDate[row.day] = unreg;
      invalidDataByDate[row.day] = inv;
      registeredTotal += reg;
      unregisteredTotal += unreg;
      invalidDataTotal += inv;
    }

    return {
      windowStart: window.start,
      windowEnd: window.end,
      dates,
      rows,
      columnTotals,
      grandTotal,
      registeredByDate,
      unregisteredByDate,
      multipleMatchesByDate: Object.fromEntries(dates.map((d) => [d, 0])),
      invalidDataByDate,
      registeredTotal,
      unregisteredTotal,
      multipleMatchesTotal: 0,
      invalidDataTotal,
    };
  });
}
