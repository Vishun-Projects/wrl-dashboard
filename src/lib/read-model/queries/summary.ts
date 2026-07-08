import { prisma } from '@/lib/db/prisma';
import type { SummaryDashboard } from '@/lib/report/summary-derive';
import { normalizeCallTypeDisplay } from '@/lib/report/filters';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';
import { AGING_BUCKET_SQL, openCallsFromAging } from '@/lib/report/aging-buckets';
import {
  HOT_MAIN_BRANCH_NAME_SQL,
  HOT_MAIN_BRANCH_OFFICE_ID_SQL,
  HOT_OFFICE_JOINS_SQL,
  HOT_RESOLVED_REGION_SQL,
} from '@/lib/read-model/queries/hot-region';

export type SummaryQueryParams = {
  startDate?: string | null;
  endDate?: string | null;
  agingAsOf?: string | null;
  officeIds?: string[];
  callTypes?: string[];
  assignedOffices?: string[];
  isHod?: boolean;
};

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function resolveAgingDate(params: SummaryQueryParams): string {
  if (params.agingAsOf) return params.agingAsOf;
  if (params.endDate) return params.endDate;
  return new Date().toISOString().slice(0, 10);
}

function buildOfficeFilter(
  params: SummaryQueryParams,
  alias: string,
  startIdx: number,
  officeColumn = 'office_id'
): {
  clause: string;
  values: unknown[];
  nextIdx: number;
} {
  const values: unknown[] = [];
  let idx = startIdx;
  const parts: string[] = [];

  if (
    !params.isHod &&
    params.assignedOffices &&
    params.assignedOffices.length > 0
  ) {
    parts.push(`${alias}.${officeColumn} = ANY($${idx}::bigint[])`);
    values.push(params.assignedOffices.map((id) => Number(id)));
    idx++;
  }

  if (params.officeIds && params.officeIds.length > 0) {
    parts.push(`${alias}.${officeColumn} = ANY($${idx}::bigint[])`);
    values.push(params.officeIds.map((id) => Number(id)));
    idx++;
  }

  return {
    clause: parts.length ? ` AND ${parts.join(' AND ')}` : '',
    values,
    nextIdx: idx,
  };
}

function buildCallTypeFilter(params: SummaryQueryParams, alias: string, startIdx: number): {
  clause: string;
  values: unknown[];
  nextIdx: number;
} {
  if (!params.callTypes || params.callTypes.length === 0) {
    return { clause: '', values: [], nextIdx: startIdx };
  }
  return {
    clause: ` AND upper(trim(${alias}.call_type)) = ANY($${startIdx}::text[])`,
    values: [params.callTypes.map((t) => normalizeCallTypeDisplay(t).toUpperCase())],
    nextIdx: startIdx + 1,
  };
}

/** Predicate for account-row breakdown metrics — respects the same call-type filter as branch summary. */
function buildAccountViewCallTypePredicate(
  params: SummaryQueryParams,
  alias: string,
  startIdx: number
): { predicate: string; values: unknown[]; nextIdx: number } {
  if (!params.callTypes || params.callTypes.length === 0) {
    return { predicate: 'TRUE', values: [], nextIdx: startIdx };
  }
  if (params.callTypes.length === 1) {
    return {
      predicate: `normalize_call_type(${alias}.call_type) = normalize_call_type($${startIdx})`,
      values: [normalizeCallTypeDisplay(params.callTypes[0])],
      nextIdx: startIdx + 1,
    };
  }
  return {
    predicate: `upper(trim(${alias}.call_type)) = ANY($${startIdx}::text[])`,
    values: [params.callTypes.map((t) => normalizeCallTypeDisplay(t).toUpperCase())],
    nextIdx: startIdx + 1,
  };
}

let normalizeCallTypeFunctionReady = false;

export async function ensureNormalizeCallTypeFunction(): Promise<void> {
  if (normalizeCallTypeFunctionReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION normalize_call_type(input text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    AS $$
      SELECT upper(trim(coalesce(input, '')))
    $$
  `);
  normalizeCallTypeFunctionReady = true;
}

export async function querySummaryDashboard(params: SummaryQueryParams): Promise<SummaryDashboard> {
  await ensureNormalizeCallTypeFunction();

  const startDate = params.startDate || yearStart();
  const endDate = params.endDate || new Date().toISOString().slice(0, 10);
  const agingDate = resolveAgingDate(params);

  const periodStart = `${startDate}T00:00:00`;
  const periodEnd = `${endDate}T23:59:59`;

  const officeFilter = buildOfficeFilter(params, 'h', 3, 'nofficeid');
  const callTypeFilter = buildCallTypeFilter(params, 'h', officeFilter.nextIdx);
  const values = [periodStart, periodEnd, ...officeFilter.values, ...callTypeFilter.values];

  const branchRows = await prisma.$queryRawUnsafeBulk<
    Array<{
      office_id: number;
      parent_id: number | null;
      branch: string | null;
      region: string;
      total_calls: number;
      solved_calls: number;
      cancelled_calls: number;
      open_calls: number;
      tech_solved_calls: number;
      deployment_total: number;
      deployment_done: number;
      installation_total: number;
      installation_done: number;
      headcount: number;
    }>
  >(
    `
    SELECT
      ${HOT_MAIN_BRANCH_OFFICE_ID_SQL} AS office_id,
      0::int AS parent_id,
      ${HOT_MAIN_BRANCH_NAME_SQL} AS branch,
      ${HOT_RESOLVED_REGION_SQL} AS region,
      count(*)::int AS total_calls,
      count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved_calls,
      count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled_calls,
      count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated', 'assigned'))::int AS open_calls,
      count(*) FILTER (WHERE h.status_bucket = 'tech_solved')::int AS tech_solved_calls,
      count(*) FILTER (WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT'))::int AS deployment_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS deployment_done,
      count(*) FILTER (WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL'))::int AS installation_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS installation_done,
      COALESCE(MAX(h.branch_headcount), 0)::int AS headcount
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      ${officeFilter.clause}
      ${callTypeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY ${HOT_MAIN_BRANCH_OFFICE_ID_SQL}, ${HOT_MAIN_BRANCH_NAME_SQL}, ${HOT_RESOLVED_REGION_SQL}
    ORDER BY branch ASC
    `,
    ...values
  );

  const agingOfficeFilter = buildOfficeFilter(params, 'h', 4, 'nofficeid');
  const agingCallTypeFilter = buildCallTypeFilter(params, 'h', agingOfficeFilter.nextIdx);
  const agingValues = [
    agingDate,
    periodStart,
    periodEnd,
    ...agingOfficeFilter.values,
    ...agingCallTypeFilter.values,
  ];

  const agingRows = await prisma.$queryRawUnsafeBulk<
    Array<{
      office_id: number;
      age_2: number;
      age_3: number;
      age_7: number;
      age_15: number;
      part_pending: number;
      active_eng: number;
    }>
  >(
    `
    SELECT
      ${HOT_MAIN_BRANCH_OFFICE_ID_SQL} AS office_id,
      ${AGING_BUCKET_SQL},
      SUM(CASE WHEN h.is_part_pending THEN 1 ELSE 0 END)::int AS part_pending,
      COUNT(DISTINCT NULLIF(h.engineer_name, ''))::int AS active_eng
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $2::timestamptz
      AND h.logged_at <= $3::timestamptz
      AND h.status_bucket IN ('open_unallocated', 'assigned')
      ${agingOfficeFilter.clause}
      ${agingCallTypeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY ${HOT_MAIN_BRANCH_OFFICE_ID_SQL}
    `,
    ...agingValues
  );

  const agingByOffice = new Map(agingRows.map((row) => [Number(row.office_id), row]));

  const branchSummary = branchRows.map((row) => {
    const aging = agingByOffice.get(Number(row.office_id));
    const age_2 = aging?.age_2 ?? 0;
    const age_3 = aging?.age_3 ?? 0;
    const age_7 = aging?.age_7 ?? 0;
    const age_15 = aging?.age_15 ?? 0;
    const openFromAging = openCallsFromAging({ age_2, age_3, age_7, age_15 });
    return {
      officeId: Number(row.office_id),
      parentId: Number(row.parent_id ?? 0),
      branch: row.branch ?? 'UNKNOWN',
      region: String(row.region ?? 'OTHER').toUpperCase(),
      total_calls: row.total_calls,
      solved_calls: row.solved_calls,
      cancelled_calls: row.cancelled_calls,
      open_calls: openFromAging > 0 ? openFromAging : row.open_calls,
      age_2,
      age_3,
      age_7,
      age_15,
      part_pending: aging?.part_pending ?? 0,
      all_total: row.total_calls,
      all_solved: row.solved_calls,
      all_cancelled: row.cancelled_calls,
      all_open: openFromAging > 0 ? openFromAging : row.open_calls,
      all_age_2: age_2,
      all_age_3: age_3,
      all_age_7: age_7,
      all_age_15: age_15,
      all_part_pending: aging?.part_pending ?? 0,
      all_tech_solved: row.tech_solved_calls,
      tech_solved_calls: row.tech_solved_calls,
      deployment_total: row.deployment_total,
      deployment_done: row.deployment_done,
      installation_total: row.installation_total,
      installation_done: row.installation_done,
      active_eng: aging?.active_eng ?? 0,
      population: row.total_calls,
      headcount: row.headcount,
    };
  });

  const accountOfficeFilter = buildOfficeFilter(params, 'h', 3, 'nofficeid');
  const viewCallType = buildAccountViewCallTypePredicate(params, 'h', accountOfficeFilter.nextIdx);
  const viewCallTypePredicate = viewCallType.predicate;
  const accountValues = [
    periodStart,
    periodEnd,
    ...accountOfficeFilter.values,
    ...viewCallType.values,
  ];

  const accountRows = await prisma.$queryRawUnsafeBulk<
    Array<{
      region: string;
      account: string;
      total_calls: number;
      total_solved: number;
      cancelled_calls: number;
      open_calls: number;
      total_tech_solved: number;
      deployment_total: number;
      deployment_done: number;
      installation_total: number;
      installation_done: number;
    }>
  >(
    `
    SELECT
      ${HOT_RESOLVED_REGION_SQL} AS region,
      h.account,
      count(*) FILTER (WHERE ${viewCallTypePredicate})::int AS total_calls,
      count(*) FILTER (
        WHERE ${viewCallTypePredicate}
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS total_solved,
      count(*) FILTER (
        WHERE ${viewCallTypePredicate}
          AND h.status_bucket = 'cancelled'
      )::int AS cancelled_calls,
      count(*) FILTER (
        WHERE ${viewCallTypePredicate}
          AND h.status_bucket IN ('open_unallocated', 'assigned')
      )::int AS open_calls,
      count(*) FILTER (
        WHERE ${viewCallTypePredicate}
          AND h.status_bucket = 'tech_solved'
      )::int AS total_tech_solved,
      count(*) FILTER (WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT'))::int AS deployment_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS deployment_done,
      count(*) FILTER (WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL'))::int AS installation_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS installation_done
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      ${accountOfficeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY ${HOT_RESOLVED_REGION_SQL}, h.account
    ORDER BY h.account ASC
    `,
    ...accountValues
  );

  const accountAgingOfficeFilter = buildOfficeFilter(params, 'h', 4, 'nofficeid');
  const agingViewCallType = buildAccountViewCallTypePredicate(
    params,
    'h',
    accountAgingOfficeFilter.nextIdx
  );
  const accountAgingValues = [
    agingDate,
    periodStart,
    periodEnd,
    ...accountAgingOfficeFilter.values,
    ...agingViewCallType.values,
  ];
  const agingViewCallTypePredicate = agingViewCallType.predicate;

  const accountAgingRows = await prisma.$queryRawUnsafeBulk<
    Array<{
      region: string;
      account: string;
      age_2: number;
      age_3: number;
      age_7: number;
      age_15: number;
      part_pending: number;
      active_eng: number;
    }>
  >(
    `
    SELECT
      ${HOT_RESOLVED_REGION_SQL} AS region,
      h.account,
      ${AGING_BUCKET_SQL},
      SUM(CASE WHEN h.is_part_pending THEN 1 ELSE 0 END)::int AS part_pending,
      COUNT(DISTINCT NULLIF(h.engineer_name, ''))::int AS active_eng
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $2::timestamptz
      AND h.logged_at <= $3::timestamptz
      AND h.status_bucket IN ('open_unallocated', 'assigned')
      AND (${agingViewCallTypePredicate})
      ${accountAgingOfficeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY ${HOT_RESOLVED_REGION_SQL}, h.account
    `,
    ...accountAgingValues
  );

  const agingByAccount = new Map(
    accountAgingRows.map((row) => [`${row.region}-${row.account}`, row])
  );

  const regionHeadcount = new Map<string, number>();
  for (const branch of branchSummary) {
    regionHeadcount.set(
      branch.region,
      (regionHeadcount.get(branch.region) ?? 0) + branch.headcount
    );
  }

  const accountSummary = accountRows.map((row) => {
    const key = `${row.region}-${row.account}`;
    const aging = agingByAccount.get(key);
    const age_2 = aging?.age_2 ?? 0;
    const age_3 = aging?.age_3 ?? 0;
    const age_7 = aging?.age_7 ?? 0;
    const age_15 = aging?.age_15 ?? 0;
    const openFromAging = openCallsFromAging({ age_2, age_3, age_7, age_15 });
    return {
      region: String(row.region ?? 'OTHER').toUpperCase(),
      account: row.account,
      population: row.total_calls,
      total_calls: row.total_calls,
      total_solved: row.total_solved,
      cancelled_calls: row.cancelled_calls,
      open_calls: openFromAging > 0 ? openFromAging : row.open_calls,
      age_2,
      age_3,
      age_7,
      age_15,
      part_pending: aging?.part_pending ?? 0,
      deployment_total: row.deployment_total,
      deployment_done: row.deployment_done,
      installation_total: row.installation_total,
      installation_done: row.installation_done,
      active_eng: aging?.active_eng ?? 0,
      headcount: regionHeadcount.get(String(row.region ?? 'OTHER').toUpperCase()) ?? 0,
      total_tech_solved: row.total_tech_solved,
    };
  });

  const globalHeadcount = branchSummary.reduce((sum, row) => sum + row.headcount, 0);

  return { branchSummary, accountSummary, globalHeadcount };
}

export function parseCsvFilter(value: string | null | undefined): string[] {
  if (!value || value === 'All' || value === 'undefined' || value === 'null') return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

export function parseCallTypes(value: string | null | undefined): string[] {
  return parseCsvFilter(value);
}
