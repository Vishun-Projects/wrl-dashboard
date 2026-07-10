import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/report/summary-derive';
import { withBulkReadClient } from '@/lib/read-model/db';
import { SNAPSHOT_IMPORT_SOURCE_CODES } from '@/lib/mis-client-import/snapshot-sources';
import type { StatusBucket } from '@/lib/mis-client-import/types';

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

import { incrementAgingBucket, openCallsFromAging } from '@/lib/report/aging-buckets';

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
        r.region,
        COALESCE(NULLIF(TRIM(s.crm_account_filter), ''), s.name) AS account,
        r.branch_label, r.logged_at, r.status_bucket, r.is_part_pending, r.engineer_name
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

async function queryDedupedRows(params: ClientAggregateParams): Promise<DbRow[]> {
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

    const res = await client.query<DbRow>(
      buildDedupedRowsSql(sourceClause, 3, bdMisSnapshotMode),
      values
    );
    return res.rows;
  });
}

export async function queryClientBranchSummary(
  params: ClientAggregateParams
): Promise<BranchSummaryRow[]> {
  const agingDate = resolveAgingDate(params);
  const rows = await queryDedupedRows(params);
  return aggregateRows(rows, agingDate);
}

export async function queryAllClientBranchSummary(
  params: Omit<ClientAggregateParams, 'sourceCode'>
): Promise<BranchSummaryRow[]> {
  return queryClientBranchSummary({ ...params, sourceCode: 'all' });
}

export async function queryClientBranchSummaryFiltered(
  params: ClientAggregateParams
): Promise<BranchSummaryRow[]> {
  const agingDate = resolveAgingDate(params);
  const rows = await queryDedupedRows(params);
  return aggregateRows(rows, agingDate);
}

export async function queryClientAccountSummaryFiltered(
  params: ClientAggregateParams
): Promise<AccountSummaryRow[]> {
  const agingDate = resolveAgingDate(params);
  const rows = await queryDedupedRows(params);
  return aggregateAccountRows(rows, agingDate);
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
  const agingDate = resolveAgingDate(params);
  const rows = await queryDedupedRows(params);
  return aggregateAccountRows(rows, agingDate);
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
  return [...best.values()].map(({ source_id: _s, call_key: _c, batch_created_at: _b, ...dbRow }) => dbRow);
}
