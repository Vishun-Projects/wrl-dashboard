import { prisma } from '@/lib/db/prisma';
import type { SummaryDashboard } from '@/lib/report/summary-derive';
import { normalizeCallTypeDisplay } from '@/lib/report/filters';

const BREAKDOWN = 'BREAKDOWN';

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

  if (!params.isHod) {
    if (!params.assignedOffices || params.assignedOffices.length === 0) {
      parts.push('FALSE');
    } else {
      parts.push(`${alias}.${officeColumn} = ANY($${idx}::bigint[])`);
      values.push(params.assignedOffices.map((id) => Number(id)));
      idx++;
    }
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

  const officeFilter = buildOfficeFilter(params, 'm', 3);
  const callTypeFilter = buildCallTypeFilter(params, 'm', officeFilter.nextIdx);
  const values = [startDate, endDate, ...officeFilter.values, ...callTypeFilter.values];

  const branchRows = await prisma.$queryRawUnsafe<
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
      m.office_id,
      d.nunder AS parent_id,
      COALESCE(d.vcompanyname, 'UNKNOWN') AS branch,
      m.region,
      SUM(m.total)::int AS total_calls,
      SUM(m.solved)::int AS solved_calls,
      SUM(m.cancelled)::int AS cancelled_calls,
      SUM(m.open_count)::int AS open_calls,
      SUM(m.tech_solved)::int AS tech_solved_calls,
      SUM(m.deployment_total)::int AS deployment_total,
      SUM(m.deployment_done)::int AS deployment_done,
      SUM(m.installation_total)::int AS installation_total,
      SUM(m.installation_done)::int AS installation_done,
      COALESCE(MAX(h.branch_headcount), 0)::int AS headcount
    FROM call_metrics_daily m
    LEFT JOIN dim_offices d ON d.ncode = m.office_id
    LEFT JOIN LATERAL (
      SELECT branch_headcount
      FROM calls_latest_hot h2
      WHERE h2.nofficeid = m.office_id
      LIMIT 1
    ) h ON true
    WHERE m.fact_date >= $1::date
      AND m.fact_date <= $2::date
      ${officeFilter.clause}
      ${callTypeFilter.clause}
    GROUP BY m.office_id, d.nunder, d.vcompanyname, m.region
    ORDER BY branch ASC
    `,
    ...values
  );

  const agingOfficeFilter = buildOfficeFilter(params, 'h', 2, 'nofficeid');
  const agingCallTypeFilter = buildCallTypeFilter(params, 'h', agingOfficeFilter.nextIdx);
  const agingValues = [agingDate, ...agingOfficeFilter.values, ...agingCallTypeFilter.values];

  const agingRows = await prisma.$queryRawUnsafe<
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
      h.nofficeid AS office_id,
      SUM(CASE WHEN ($1::date - h.logged_at::date) <= 2 THEN 1 ELSE 0 END)::int AS age_2,
      SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 3 AND 7 THEN 1 ELSE 0 END)::int AS age_3,
      SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 8 AND 15 THEN 1 ELSE 0 END)::int AS age_7,
      SUM(CASE WHEN ($1::date - h.logged_at::date) > 15 THEN 1 ELSE 0 END)::int AS age_15,
      SUM(CASE WHEN h.is_part_pending THEN 1 ELSE 0 END)::int AS part_pending,
      COUNT(DISTINCT NULLIF(h.engineer_name, ''))::int AS active_eng
    FROM calls_latest_hot h
    WHERE h.status_bucket IN ('open_unallocated', 'assigned')
      ${agingOfficeFilter.clause}
      ${agingCallTypeFilter.clause}
    GROUP BY h.nofficeid
    `,
    ...agingValues
  );

  const agingByOffice = new Map(agingRows.map((row) => [Number(row.office_id), row]));

  const branchSummary = branchRows.map((row) => {
    const aging = agingByOffice.get(Number(row.office_id));
    return {
      officeId: Number(row.office_id),
      parentId: Number(row.parent_id ?? 0),
      branch: row.branch ?? 'UNKNOWN',
      region: String(row.region ?? 'OTHER').toUpperCase(),
      total_calls: row.total_calls,
      solved_calls: row.solved_calls,
      cancelled_calls: row.cancelled_calls,
      open_calls: row.open_calls,
      age_2: aging?.age_2 ?? 0,
      age_3: aging?.age_3 ?? 0,
      age_7: aging?.age_7 ?? 0,
      age_15: aging?.age_15 ?? 0,
      part_pending: aging?.part_pending ?? 0,
      all_total: row.total_calls,
      all_solved: row.solved_calls,
      all_cancelled: row.cancelled_calls,
      all_open: row.open_calls,
      all_age_2: aging?.age_2 ?? 0,
      all_age_3: aging?.age_3 ?? 0,
      all_age_7: aging?.age_7 ?? 0,
      all_age_15: aging?.age_15 ?? 0,
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

  const accountOfficeFilter = buildOfficeFilter(params, 'm', 4);
  const accountValues = [startDate, endDate, BREAKDOWN, ...accountOfficeFilter.values];

  const accountRows = await prisma.$queryRawUnsafe<
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
      m.region,
      m.account,
      SUM(CASE WHEN normalize_call_type(m.call_type) = normalize_call_type($3) THEN m.total ELSE 0 END)::int AS total_calls,
      SUM(CASE WHEN normalize_call_type(m.call_type) = normalize_call_type($3) THEN m.solved ELSE 0 END)::int AS total_solved,
      SUM(CASE WHEN normalize_call_type(m.call_type) = normalize_call_type($3) THEN m.cancelled ELSE 0 END)::int AS cancelled_calls,
      SUM(CASE WHEN normalize_call_type(m.call_type) = normalize_call_type($3) THEN m.open_count ELSE 0 END)::int AS open_calls,
      SUM(CASE WHEN normalize_call_type(m.call_type) = normalize_call_type($3) THEN m.tech_solved ELSE 0 END)::int AS total_tech_solved,
      SUM(m.deployment_total)::int AS deployment_total,
      SUM(m.deployment_done)::int AS deployment_done,
      SUM(m.installation_total)::int AS installation_total,
      SUM(m.installation_done)::int AS installation_done
    FROM call_metrics_daily m
    WHERE m.fact_date >= $1::date
      AND m.fact_date <= $2::date
      ${accountOfficeFilter.clause}
    GROUP BY m.region, m.account
    ORDER BY m.account ASC
    `,
    ...accountValues
  );

  const accountAgingOfficeFilter = buildOfficeFilter(params, 'h', 3, 'nofficeid');
  const accountAgingValues = [agingDate, BREAKDOWN, ...accountAgingOfficeFilter.values];

  const accountAgingRows = await prisma.$queryRawUnsafe<
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
      h.region,
      h.account,
      SUM(CASE WHEN ($1::date - h.logged_at::date) <= 2 THEN 1 ELSE 0 END)::int AS age_2,
      SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 3 AND 7 THEN 1 ELSE 0 END)::int AS age_3,
      SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 8 AND 15 THEN 1 ELSE 0 END)::int AS age_7,
      SUM(CASE WHEN ($1::date - h.logged_at::date) > 15 THEN 1 ELSE 0 END)::int AS age_15,
      SUM(CASE WHEN h.is_part_pending THEN 1 ELSE 0 END)::int AS part_pending,
      COUNT(DISTINCT NULLIF(h.engineer_name, ''))::int AS active_eng
    FROM calls_latest_hot h
    WHERE h.status_bucket IN ('open_unallocated', 'assigned')
      AND normalize_call_type(h.call_type) = normalize_call_type($2)
      ${accountAgingOfficeFilter.clause}
    GROUP BY h.region, h.account
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
    return {
      region: String(row.region ?? 'OTHER').toUpperCase(),
      account: row.account,
      population: row.total_calls,
      total_calls: row.total_calls,
      total_solved: row.total_solved,
      cancelled_calls: row.cancelled_calls,
      open_calls: row.open_calls,
      age_2: aging?.age_2 ?? 0,
      age_3: aging?.age_3 ?? 0,
      age_7: aging?.age_7 ?? 0,
      age_15: aging?.age_15 ?? 0,
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
