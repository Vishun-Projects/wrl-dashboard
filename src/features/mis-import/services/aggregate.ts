import type { AccountSummaryRow, BranchSummaryRow } from '@/features/report';
import { withBulkReadClient } from '@/lib/read-model/db';
import { SNAPSHOT_IMPORT_SOURCE_CODES } from '@/features/mis-import/services/snapshot-sources';
import type { StatusBucket } from '@/features/mis-import/services/types';

export type ClientAggregateParams = {
  sourceCode?: string | null;
  sourceCodes?: string[] | null;
  startDate?: string | null;
  endDate?: string | null;
  agingAsOf?: string | null;
  /** BD MIS Excel: count every row in the latest Coke/Cadbury snapshot batch (no logged_at filter). */
  bdMisSnapshotMode?: boolean;
};

type DbRow = {
  region: string;
  account: string;
  branch_label: string | null;
  logged_at: Date | null;
  status_bucket: StatusBucket;
  is_part_pending: boolean;
  engineer_name: string | null;
};

function resolveAgingDate(params: ClientAggregateParams): string {
  if (params.agingAsOf) return params.agingAsOf;
  if (params.endDate) return params.endDate;
  return new Date().toISOString().slice(0, 10);
}

import { incrementAgingBucket, openCallsFromAging } from '@/features/report';

function sqlDayDiff(loggedAt: Date, agingDate: string): number {
  const callDate = new Date(loggedAt);
  const aging = new Date(`${agingDate}T23:59:59`);
  const startUtc = Date.UTC(callDate.getFullYear(), callDate.getMonth(), callDate.getDate());
  const endUtc = Date.UTC(aging.getFullYear(), aging.getMonth(), aging.getDate());
  return Math.floor((endUtc - startUtc) / 86400000);
}

function isOpen(bucket: StatusBucket): boolean {
  return bucket === 'open_unallocated' || bucket === 'assigned';
}

function isSolved(bucket: StatusBucket): boolean {
  return bucket === 'solved' || bucket === 'tech_solved';
}

function branchKey(region: string, branchLabel: string | null): string {
  return `${region}::${branchLabel ?? region}`;
}

function accountKey(region: string, account: string): string {
  return `${region}::${account}`;
}

function emptyAccountRow(region: string, account: string): AccountSummaryRow {
  return {
    region,
    account,
    population: 0,
    total_calls: 0,
    total_solved: 0,
    cancelled_calls: 0,
    open_calls: 0,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 0,
    headcount: 0,
    total_tech_solved: 0,
  };
}

function emptyBranchRow(region: string, branch: string, officeId: number): BranchSummaryRow {
  return {
    officeId,
    parentId: 0,
    branch,
    region,
    total_calls: 0,
    solved_calls: 0,
    cancelled_calls: 0,
    open_calls: 0,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    all_total: 0,
    all_solved: 0,
    all_cancelled: 0,
    all_open: 0,
    all_age_2: 0,
    all_age_3: 0,
    all_age_7: 0,
    all_age_15: 0,
    all_part_pending: 0,
    all_tech_solved: 0,
    tech_solved_calls: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 0,
    population: 0,
    headcount: 0,
  };
}

function aggregateRows(rows: DbRow[], agingDate: string): BranchSummaryRow[] {
  const branchMap = new Map<string, BranchSummaryRow & { engineers: Set<string> }>();
  let syntheticId = -1;

  for (const row of rows) {
    const region = String(row.region ?? 'OTHER').toUpperCase();
    const branch = row.branch_label?.trim() || region;
    const key = branchKey(region, branch);

    if (!branchMap.has(key)) {
      syntheticId -= 1;
      branchMap.set(key, {
        ...emptyBranchRow(region, branch, syntheticId),
        engineers: new Set<string>(),
      });
    }

    const b = branchMap.get(key)!;

    if (row.status_bucket === 'cancelled') {
      b.cancelled_calls += 1;
      b.all_cancelled += 1;
      continue;
    }

    b.total_calls += 1;
    b.all_total += 1;
    b.population += 1;

    if (isSolved(row.status_bucket)) {
      b.solved_calls += 1;
      b.all_solved += 1;
      if (row.status_bucket === 'tech_solved') {
        b.tech_solved_calls += 1;
        b.all_tech_solved += 1;
      }
    }
    if (isOpen(row.status_bucket)) {
      b.open_calls += 1;
      b.all_open += 1;
      if (row.logged_at) {
        const dayDiff = sqlDayDiff(row.logged_at, agingDate);
        incrementAgingBucket(b, dayDiff);
      }
    }
    if (row.is_part_pending) {
      b.part_pending += 1;
      b.all_part_pending += 1;
    }
    if (row.engineer_name) b.engineers.add(row.engineer_name.trim().toLowerCase());
  }

  return [...branchMap.values()]
    .map(({ engineers, ...row }) => {
      const agingOpen = openCallsFromAging(row);
      return {
        ...row,
        open_calls: agingOpen > 0 ? agingOpen : row.open_calls,
        all_open: agingOpen > 0 ? agingOpen : row.all_open,
        active_eng: engineers.size,
      };
    })
    .sort((a, b) => a.branch.localeCompare(b.branch));
}

function aggregateAccountRows(rows: DbRow[], agingDate: string): AccountSummaryRow[] {
  const accountMap = new Map<string, AccountSummaryRow & { engineers: Set<string> }>();

  for (const row of rows) {
    const region = String(row.region ?? 'OTHER').toUpperCase();
    const account = String(row.account ?? 'UNCLASSIFIED').trim() || 'UNCLASSIFIED';
    const key = accountKey(region, account);

    if (!accountMap.has(key)) {
      accountMap.set(key, {
        ...emptyAccountRow(region, account),
        engineers: new Set<string>(),
      });
    }

    const a = accountMap.get(key)!;

    if (row.status_bucket === 'cancelled') {
      a.cancelled_calls += 1;
      continue;
    }

    a.total_calls += 1;
    a.population += 1;

    if (isSolved(row.status_bucket)) {
      a.total_solved += 1;
      if (row.status_bucket === 'tech_solved') {
        a.total_tech_solved += 1;
      }
    }
    if (isOpen(row.status_bucket)) {
      a.open_calls += 1;
      if (row.logged_at) {
        const dayDiff = sqlDayDiff(row.logged_at, agingDate);
        incrementAgingBucket(a, dayDiff);
      }
    }
    if (row.is_part_pending) {
      a.part_pending += 1;
    }
    if (row.engineer_name) a.engineers.add(row.engineer_name.trim().toLowerCase());
  }

  return [...accountMap.values()]
    .map(({ engineers, ...row }) => {
      const agingOpen = openCallsFromAging(row);
      return {
        ...row,
        open_calls: agingOpen > 0 ? agingOpen : row.open_calls,
        active_eng: engineers.size,
      };
    })
    .sort((a, b) => a.account.localeCompare(b.account) || a.region.localeCompare(b.region));
}

function resolveSourceFilter(params: ClientAggregateParams): string[] | null {
  if (params.sourceCodes?.length) {
    return params.sourceCodes.map((c) => c.toLowerCase());
  }
  if (!params.sourceCode || params.sourceCode === 'all') return null;
  return [params.sourceCode.toLowerCase()];
}

function buildDedupedRowsSql(
  sourceClause: string,
  snapshotParamIndex: number,
  bdMisSnapshotMode: boolean,
  opts?: { includeSourceCode?: boolean }
): string {
  const dateFilter = bdMisSnapshotMode
    ? `AND (
          (s.code = ANY($${snapshotParamIndex}::text[]) AND b.batch_id = lb.batch_id)
          OR (
            s.code <> ALL($${snapshotParamIndex}::text[])
            AND r.logged_at >= $1::date
            AND r.logged_at <= ($2::date + interval '1 day' - interval '1 second')
          )
        )`
    : `AND r.logged_at >= $1::date
        AND r.logged_at <= ($2::date + interval '1 day' - interval '1 second')
        AND (
          (s.code = ANY($${snapshotParamIndex}::text[]) AND b.batch_id = lb.batch_id)
          OR (s.code <> ALL($${snapshotParamIndex}::text[]))
        )`;

  const selectCols = opts?.includeSourceCode
    ? `s.code AS source_code,
        r.region,
        COALESCE(NULLIF(TRIM(s.crm_account_filter), ''), s.name) AS account,
        r.branch_label, r.logged_at, r.status_bucket, r.is_part_pending, r.engineer_name`
    : `r.region,
        COALESCE(NULLIF(TRIM(s.crm_account_filter), ''), s.name) AS account,
        r.branch_label, r.logged_at, r.status_bucket, r.is_part_pending, r.engineer_name`;

  return `
      WITH latest_batch AS (
        SELECT DISTINCT ON (b.source_id)
          b.source_id,
          b.batch_id
        FROM mis_client_import_batches b
        WHERE b.status = 'completed'
        ORDER BY b.source_id, b.created_at DESC
      )
      SELECT DISTINCT ON (r.source_id, r.call_key)
        ${selectCols}
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      LEFT JOIN latest_batch lb ON lb.source_id = r.source_id
      WHERE b.status = 'completed'
        AND r.source_id IS NOT NULL
        ${sourceClause}
        ${dateFilter}
      ORDER BY r.source_id, r.call_key, b.created_at DESC
    `;
}

export async function queryClientBranchSummary(
  params: ClientAggregateParams
): Promise<BranchSummaryRow[]> {
  const { branchSummary } = await queryClientAggregates(params);
  return branchSummary;
}

export async function queryAllClientBranchSummary(
  params: Omit<ClientAggregateParams, 'sourceCode'>
): Promise<BranchSummaryRow[]> {
  return queryClientBranchSummary({ ...params, sourceCode: 'all' });
}

/** One dedupe fetch → branch + account rollups + row count. */
export function clientAggregatesFromRows(
  rows: DbRow[],
  agingDate: string
): {
  branchSummary: BranchSummaryRow[];
  accountSummary: AccountSummaryRow[];
  rowsInDateRange: number;
} {
  return {
    branchSummary: aggregateRows(rows, agingDate),
    accountSummary: aggregateAccountRows(rows, agingDate),
    rowsInDateRange: rows.length,
  };
}

type ClientAggregateQueryRow = {
  branch_summary: BranchSummaryRow[];
  account_summary: AccountSummaryRow[];
  rows_in_date_range: number;
};

/**
 * SQL mirror of aggregateRows/aggregateAccountRows.  The pure JS helper remains
 * covered by aggregate-shared.test.ts; this query deliberately retains its
 * cancellation, aging, and normalized engineer semantics while avoiding row transfer.
 */
function buildClientAggregatesSql(
  sourceClause: string,
  sourceParamIndex: number,
  agingParamIndex: number,
  bdMisSnapshotMode: boolean
): string {
  const agingDate = `$${agingParamIndex}::date`;
  const age = (predicate: string) =>
    `count(*) FILTER (
      WHERE status_bucket IN ('open_unallocated', 'assigned')
        AND logged_at IS NOT NULL
        AND ${predicate}
    )::int`;
  const aggregateColumns = (solved: string, techSolved: string, prefix = '') => `
      count(*) FILTER (WHERE status_bucket <> 'cancelled')::int AS ${prefix}total_calls,
      count(*) FILTER (WHERE status_bucket IN ('solved', 'tech_solved'))::int AS ${solved},
      count(*) FILTER (WHERE status_bucket = 'cancelled')::int AS ${prefix}cancelled_calls,
      count(*) FILTER (WHERE status_bucket IN ('open_unallocated', 'assigned'))::int AS raw_open_calls,
      ${age(`(${agingDate} - logged_at::date) <= 2`)} AS ${prefix}age_2,
      ${age(`(${agingDate} - logged_at::date) BETWEEN 3 AND 7`)} AS ${prefix}age_3,
      ${age(`(${agingDate} - logged_at::date) BETWEEN 8 AND 15`)} AS ${prefix}age_7,
      ${age(`(${agingDate} - logged_at::date) > 15`)} AS ${prefix}age_15,
      count(*) FILTER (WHERE status_bucket <> 'cancelled' AND is_part_pending)::int AS ${prefix}part_pending,
      count(DISTINCT lower(trim(engineer_name))) FILTER (
        WHERE status_bucket <> 'cancelled' AND engineer_name IS NOT NULL
      )::int AS active_eng,
      count(*) FILTER (WHERE status_bucket <> 'cancelled')::int AS population,
      count(*) FILTER (WHERE status_bucket = 'tech_solved')::int AS ${techSolved}`;

  return `
    WITH deduped AS MATERIALIZED (
      ${buildDedupedRowsSql(sourceClause, sourceParamIndex, bdMisSnapshotMode).trim()}
    ),
    normalized AS (
      SELECT
        upper(COALESCE(region, 'OTHER')) AS region,
        COALESCE(NULLIF(trim(branch_label), ''), upper(COALESCE(region, 'OTHER'))) AS branch,
        COALESCE(NULLIF(trim(account), ''), 'UNCLASSIFIED') AS account,
        logged_at,
        status_bucket,
        is_part_pending,
        engineer_name
      FROM deduped
    ),
    branch_aggregate AS (
      SELECT
        region,
        branch,
        ${aggregateColumns('solved_calls', 'tech_solved_calls')},
        count(*) FILTER (WHERE status_bucket <> 'cancelled')::int AS all_total,
        count(*) FILTER (WHERE status_bucket IN ('solved', 'tech_solved'))::int AS all_solved,
        count(*) FILTER (WHERE status_bucket = 'cancelled')::int AS all_cancelled,
        count(*) FILTER (WHERE status_bucket <> 'cancelled' AND is_part_pending)::int AS all_part_pending,
        count(*) FILTER (WHERE status_bucket = 'tech_solved')::int AS all_tech_solved
      FROM normalized
      GROUP BY region, branch
    ),
    branch_rows AS (
      SELECT
        -row_number() OVER (ORDER BY branch, region)::int AS "officeId",
        0::int AS "parentId",
        branch,
        region,
        total_calls,
        solved_calls,
        cancelled_calls,
        CASE WHEN age_2 + age_3 + age_7 + age_15 > 0
          THEN age_2 + age_3 + age_7 + age_15 ELSE raw_open_calls END AS open_calls,
        age_2, age_3, age_7, age_15, part_pending,
        all_total, all_solved, all_cancelled,
        CASE WHEN age_2 + age_3 + age_7 + age_15 > 0
          THEN age_2 + age_3 + age_7 + age_15 ELSE raw_open_calls END AS all_open,
        0::int AS all_age_2,
        0::int AS all_age_3,
        0::int AS all_age_7,
        0::int AS all_age_15,
        all_part_pending, all_tech_solved,
        tech_solved_calls,
        0::int AS deployment_total,
        0::int AS deployment_done,
        0::int AS installation_total,
        0::int AS installation_done,
        active_eng,
        population,
        0::int AS headcount
      FROM branch_aggregate
    ),
    account_aggregate AS (
      SELECT
        region,
        account,
        ${aggregateColumns('total_solved', 'total_tech_solved')}
      FROM normalized
      GROUP BY region, account
    ),
    account_rows AS (
      SELECT
        region,
        account,
        population,
        total_calls,
        total_solved,
        cancelled_calls,
        CASE WHEN age_2 + age_3 + age_7 + age_15 > 0
          THEN age_2 + age_3 + age_7 + age_15 ELSE raw_open_calls END AS open_calls,
        age_2, age_3, age_7, age_15, part_pending,
        0::int AS deployment_total,
        0::int AS deployment_done,
        0::int AS installation_total,
        0::int AS installation_done,
        active_eng,
        0::int AS headcount,
        total_tech_solved
      FROM account_aggregate
    )
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.branch) FROM branch_rows b), '[]'::jsonb)
        AS branch_summary,
      COALESCE(
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.account, a.region) FROM account_rows a),
        '[]'::jsonb
      ) AS account_summary,
      (SELECT count(*)::int FROM deduped) AS rows_in_date_range
  `;
}

export async function queryClientAggregates(params: ClientAggregateParams): Promise<{
  branchSummary: BranchSummaryRow[];
  accountSummary: AccountSummaryRow[];
  rowsInDateRange: number;
}> {
  const startDate = params.startDate ?? `${new Date().getFullYear()}-01-01`;
  const endDate = params.endDate ?? new Date().toISOString().slice(0, 10);
  const sourceCodes = resolveSourceFilter(params);
  const values: unknown[] = [startDate, endDate, [...SNAPSHOT_IMPORT_SOURCE_CODES]];
  let sourceClause = '';
  if (sourceCodes) {
    values.push(sourceCodes);
    sourceClause = `AND s.code = ANY($${values.length}::text[])`;
  }
  values.push(resolveAgingDate(params));

  return withBulkReadClient(async (client) => {
    const res = await client.query<ClientAggregateQueryRow>(
      buildClientAggregatesSql(
        sourceClause,
        3,
        values.length,
        params.bdMisSnapshotMode === true
      ),
      values
    );
    const row = res.rows[0];
    return {
      branchSummary: row?.branch_summary ?? [],
      accountSummary: row?.account_summary ?? [],
      rowsInDateRange: Number(row?.rows_in_date_range) || 0,
    };
  });
}

export async function queryClientBranchSummaryFiltered(
  params: ClientAggregateParams
): Promise<BranchSummaryRow[]> {
  const { branchSummary } = await queryClientAggregates(params);
  return branchSummary;
}

export async function queryClientAccountSummaryFiltered(
  params: ClientAggregateParams
): Promise<AccountSummaryRow[]> {
  const { accountSummary } = await queryClientAggregates(params);
  return accountSummary;
}

/** Client counts for BD MIS regional union — full snapshot file rows, not logged_at filtered. */
export async function queryClientAccountSummaryForBdMis(
  params: Omit<ClientAggregateParams, 'bdMisSnapshotMode'>
): Promise<AccountSummaryRow[]> {
  return queryClientAccountSummaryFiltered({ ...params, bdMisSnapshotMode: true });
}

export async function queryClientAccountSummary(
  params: ClientAggregateParams
): Promise<AccountSummaryRow[]> {
  const { accountSummary } = await queryClientAggregates(params);
  return accountSummary;
}

export async function queryAllClientAccountSummary(
  params: Omit<ClientAggregateParams, 'sourceCode'>
): Promise<AccountSummaryRow[]> {
  return queryClientAccountSummary({ ...params, sourceCode: 'all' });
}

export async function countClientRowsInRange(params: ClientAggregateParams): Promise<number> {
  const startDate = params.startDate ?? `${new Date().getFullYear()}-01-01`;
  const endDate = params.endDate ?? new Date().toISOString().slice(0, 10);
  const sourceCodes = resolveSourceFilter(params);

  return withBulkReadClient(async (client) => {
    const values: unknown[] = [startDate, endDate, [...SNAPSHOT_IMPORT_SOURCE_CODES]];
    let sourceClause = '';
    if (sourceCodes) {
      values.push(sourceCodes);
      sourceClause = `AND s.code = ANY($${values.length}::text[])`;
    }

    const res = await client.query<{ n: number }>(
      `
      SELECT count(*)::int AS n
      FROM (
        ${buildDedupedRowsSql(sourceClause, 3, params.bdMisSnapshotMode === true).trim()}
      ) deduped
      `,
      values
    );
    return res.rows[0]?.n ?? 0;
  });
}

/** Single dedupe pass grouped by source code (avoids N+1 counts on /meta). */
export async function countClientRowsInRangeBySource(
  params: ClientAggregateParams
): Promise<{ total: number; bySource: Record<string, number> }> {
  const startDate = params.startDate ?? `${new Date().getFullYear()}-01-01`;
  const endDate = params.endDate ?? new Date().toISOString().slice(0, 10);
  const sourceCodes = resolveSourceFilter(params);

  return withBulkReadClient(async (client) => {
    const values: unknown[] = [startDate, endDate, [...SNAPSHOT_IMPORT_SOURCE_CODES]];
    let sourceClause = '';
    if (sourceCodes) {
      values.push(sourceCodes);
      sourceClause = `AND s.code = ANY($${values.length}::text[])`;
    }

    const res = await client.query<{ source_code: string; n: number }>(
      `
      SELECT source_code, count(*)::int AS n
      FROM (
        ${buildDedupedRowsSql(sourceClause, 3, params.bdMisSnapshotMode === true, {
          includeSourceCode: true,
        }).trim()}
      ) deduped
      GROUP BY source_code
      `,
      values
    );

    const bySource: Record<string, number> = {};
    let total = 0;
    for (const row of res.rows) {
      const code = String(row.source_code ?? '').toLowerCase();
      const n = Number(row.n) || 0;
      bySource[code] = n;
      total += n;
    }
    return { total, bySource };
  });
}

export type ClientRowWithBatchMeta = DbRow & {
  source_id: string;
  call_key: string;
  batch_created_at: Date;
};

export type ClientCallTraceDbRow = {
  source_code: string;
  region: string;
  plant: string | null;
  technician_name: string | null;
  office_under_branch: string | null;
  customer_name: string | null;
  logged_at: Date | null;
  service_order: string;
  client: string;
  call_status: string | null;
  status_bucket: StatusBucket;
  file_name: string | null;
};

function buildDedupedTraceRowsSql(
  sourceClause: string,
  snapshotParamIndex: number,
  bdMisSnapshotMode: boolean
): string {
  const dateFilter = bdMisSnapshotMode
    ? `AND (
          (s.code = ANY($${snapshotParamIndex}::text[]) AND b.batch_id = lb.batch_id)
          OR (
            s.code <> ALL($${snapshotParamIndex}::text[])
            AND r.logged_at >= $1::date
            AND r.logged_at <= ($2::date + interval '1 day' - interval '1 second')
          )
        )`
    : `AND r.logged_at >= $1::date
        AND r.logged_at <= ($2::date + interval '1 day' - interval '1 second')
        AND (
          (s.code = ANY($${snapshotParamIndex}::text[]) AND b.batch_id = lb.batch_id)
          OR (s.code <> ALL($${snapshotParamIndex}::text[]))
        )`;

  return `
      WITH latest_batch AS (
        SELECT DISTINCT ON (b.source_id)
          b.source_id,
          b.batch_id
        FROM mis_client_import_batches b
        WHERE b.status = 'completed'
        ORDER BY b.source_id, b.created_at DESC
      )
      SELECT DISTINCT ON (r.source_id, r.call_key)
        s.code AS source_code,
        r.region,
        COALESCE(
          CASE
            WHEN d_mapped.ncode IS NOT NULL
              THEN d_mapped.ncode::text || ' - ' || d_mapped.vcompanyname
          END,
          NULLIF(TRIM(r.state), ''),
          NULLIF(TRIM(r.raw->>'State'), ''),
          NULLIF(TRIM(r.raw->>'Entity Name'), '')
        ) AS plant,
        NULLIF(TRIM(r.engineer_name), '') AS technician_name,
        COALESCE(
          NULLIF(TRIM(r.raw->>'Customer Name'), ''),
          NULLIF(TRIM(r.raw->>'CustomerName'), ''),
          NULLIF(TRIM(r.raw->>'Customer'), ''),
          NULLIF(TRIM(r.raw->>'Town'), ''),
          NULLIF(TRIM(r.raw->>'Branchname'), ''),
          NULLIF(TRIM(r.branch_label), ''),
          NULLIF(TRIM(r.state), '')
        ) AS office_under_branch,
        COALESCE(
          NULLIF(TRIM(r.raw->>'Customer Name'), ''),
          NULLIF(TRIM(r.raw->>'CustomerName'), ''),
          NULLIF(TRIM(r.raw->>'Customer'), ''),
          NULLIF(TRIM(r.raw->>'Branchname'), ''),
          NULLIF(TRIM(r.raw->>'Town'), ''),
          NULLIF(TRIM(r.branch_label), '')
        ) AS customer_name,
        r.logged_at,
        r.call_key AS service_order,
        COALESCE(NULLIF(TRIM(s.crm_account_filter), ''), s.name) AS client,
        r.status_label AS call_status,
        r.status_bucket,
        b.file_name
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      LEFT JOIN mis_client_state_mappings sm
        ON sm.source_id = r.source_id
        AND lower(trim(sm.client_state)) = lower(trim(COALESCE(
          NULLIF(TRIM(r.state), ''),
          NULLIF(TRIM(r.raw->>'Entity Name'), ''),
          NULLIF(TRIM(r.raw->>'State'), '')
        )))
      LEFT JOIN dim_offices d_mapped
        ON d_mapped.ncode = NULLIF(TRIM(sm.plan_code), '')::bigint
      LEFT JOIN latest_batch lb ON lb.source_id = r.source_id
      WHERE b.status = 'completed'
        AND r.source_id IS NOT NULL
        ${sourceClause}
        ${dateFilter}
      ORDER BY r.source_id, r.call_key, b.created_at DESC
    `;
}

async function queryDedupedTraceRows(params: ClientAggregateParams): Promise<ClientCallTraceDbRow[]> {
  const startDate = params.startDate ?? `${new Date().getFullYear()}-01-01`;
  const endDate = params.endDate ?? new Date().toISOString().slice(0, 10);
  const sourceCodes = resolveSourceFilter(params);
  const bdMisSnapshotMode = params.bdMisSnapshotMode === true;

  return withBulkReadClient(async (client) => {
    const values: unknown[] = [startDate, endDate, [...SNAPSHOT_IMPORT_SOURCE_CODES]];
    let sourceClause = '';
    if (sourceCodes) {
      values.push(sourceCodes);
      sourceClause = `AND s.code = ANY($${values.length}::text[])`;
    }

    const res = await client.query<ClientCallTraceDbRow>(
      buildDedupedTraceRowsSql(sourceClause, 3, bdMisSnapshotMode),
      values
    );
    return res.rows;
  });
}

/** Client call rows for BD MIS trace export — full snapshot file rows for Coke/Cadbury. */
export async function queryClientCallTraceRowsForBdMis(
  params: Omit<ClientAggregateParams, 'bdMisSnapshotMode'>
): Promise<ClientCallTraceDbRow[]> {
  return queryDedupedTraceRows({ ...params, bdMisSnapshotMode: true });
}

/** Client call rows for Summary dashboard trace — same date filter as the on-screen merge. */
export async function queryClientCallTraceRowsFiltered(
  params: Omit<ClientAggregateParams, 'bdMisSnapshotMode'>
): Promise<ClientCallTraceDbRow[]> {
  return queryDedupedTraceRows({ ...params, bdMisSnapshotMode: false });
}

/** Mirrors DISTINCT ON (source_id, call_key) ORDER BY batch_created_at DESC */
export function dedupeClientRowsLatestBatchWins(rows: ClientRowWithBatchMeta[]): DbRow[] {
  const best = new Map<string, ClientRowWithBatchMeta>();
  for (const row of rows) {
    const key = `${row.source_id}\0${row.call_key}`;
    const prev = best.get(key);
    if (!prev || row.batch_created_at > prev.batch_created_at) {
      best.set(key, row);
    }
  }
  return [...best.values()].map(({ source_id, call_key, batch_created_at, ...dbRow }) => {
    void source_id;
    void call_key;
    void batch_created_at;
    return dbRow;
  });
}
