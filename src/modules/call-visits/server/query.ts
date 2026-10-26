import { withAppClient } from '@/lib/read-model/db';
import {
  buildCallPartsFilterSql,
  CALL_PARTS_BRANCH,
  CALL_PARTS_CLIENT,
  CALL_PARTS_CUSTOMER,
  CALL_PARTS_ENGINEER,
  CALL_PARTS_CATEGORY,
  CALL_PARTS_CATEGORY_JOIN,
  CALL_PARTS_FROM,
  CALL_PARTS_HOT_COLS,
  CALL_PARTS_MODEL,
  CALL_PARTS_PLANT,
  CALL_PARTS_STATUS,
  type CallPartsFilterInput,
} from '@/sql/call-visits/query';
import { CALL_PARTS_ENTITY } from '@/modules/call-visits/server/sync/postgres-sync';
import type { CallPartRow, CallPartsOptions, CallPartsRowsResponse } from '@/modules/call-visits/types';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultMonthRange(): { startDate: string; endDate: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    startDate: `${pick('year')}-${pick('month')}-01`,
    endDate: `${pick('year')}-${pick('month')}-${pick('day')}`,
  };
}

export type CallPartsFilters = CallPartsFilterInput & {
  page: number;
  pageSize: number;
  sort: CallPartSortKey | null;
  dir: 'asc' | 'desc';
};

const SORT_EXPR = {
  callNo: 'p.call_no',
  visitNo: 'p.visit_no',
  visitAt: 'p.visit_at',
  callLoggedAt: 'h.logged_at',
  plantName: CALL_PARTS_PLANT,
  branchName: CALL_PARTS_BRANCH,
  clientName: CALL_PARTS_CLIENT,
  partyName: CALL_PARTS_CUSTOMER,
  city: `NULLIF(btrim(h.city), '')`,
  statusLabel: CALL_PARTS_STATUS,
  engineerName: CALL_PARTS_ENGINEER,
  barcode: `NULLIF(btrim(h.serial), '')`,
  machineName: `NULLIF(btrim(h.item_name), '')`,
  modelCode: CALL_PARTS_MODEL,
  partCategory: CALL_PARTS_CATEGORY,
  partCode: 'p.part_code',
  partName: 'p.part_name',
  qty: `CASE WHEN p.qty ~ '^[0-9]+(\\.[0-9]+)?$' THEN p.qty::numeric END`,
  oldBarcode: 'p.old_barcode',
  newBarcode: 'p.new_barcode',
  remarks: 'p.remarks',
};

const SORT_KEYS = new Set<string>(Object.keys(SORT_EXPR));

export type CallPartSortKey = keyof typeof SORT_EXPR;

function listOrder(sort: CallPartSortKey | null, dir: 'asc' | 'desc'): string {
  const tail = 'p.call_no, p.visit_no, p.part_name, p.ncode';
  if (!sort) return `h.logged_at DESC NULLS LAST, ${tail}`;
  const sqlDir = dir === 'desc' ? 'DESC' : 'ASC';
  return `${SORT_EXPR[sort]} ${sqlDir} NULLS LAST, ${tail}`;
}

export function parseCallPartsFilters(
  searchParams: URLSearchParams
): Omit<CallPartsFilters, 'isHod' | 'assignedOffices'> {
  const allTime = searchParams.get('allTime') === '1';
  const defaults = defaultMonthRange();
  const startDate = searchParams.get('startDate')?.trim() || defaults.startDate;
  const endDate = searchParams.get('endDate')?.trim() || defaults.endDate;
  if (!allTime && (!YMD_RE.test(startDate) || !YMD_RE.test(endDate))) {
    throw new Error('startDate and endDate must be YYYY-MM-DD');
  }
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50) || 50));
  const sortRaw = searchParams.get('sort')?.trim() ?? '';
  const sort = SORT_KEYS.has(sortRaw) ? (sortRaw as CallPartSortKey) : null;
  const dir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  return {
    allTime,
    startDate,
    endDate,
    search: searchParams.get('search')?.trim() ?? '',
    plant: searchParams.get('plant')?.trim() ?? '',
    branch: searchParams.get('branch')?.trim() ?? '',
    client: searchParams.get('client')?.trim() ?? '',
    customer: searchParams.get('customer')?.trim() ?? '',
    engineer: searchParams.get('engineer')?.trim() ?? '',
    status: searchParams.get('status')?.trim() ?? '',
    part: searchParams.get('part')?.trim() ?? '',
    category: searchParams.get('category')?.trim() ?? '',
    page,
    pageSize,
    sort,
    dir,
  };
}

function ymd(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return String(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type DbRow = {
  ncode: string;
  nofficeid: string;
  call_no: string | null;
  visit_no: string | null;
  visit_at: string | Date | null;
  part_category: string | null;
  part_code: string | null;
  part_name: string | null;
  qty: string | null;
  old_barcode: string | null;
  new_barcode: string | null;
  remarks: string | null;
  call_logged_at: Date | string | null;
  barcode: string | null;
  machine_name: string | null;
  model_code: string | null;
  plant_name: string | null;
  branch_name: string | null;
  party_name: string | null;
  engineer_name: string | null;
  client_name: string | null;
  city: string | null;
  status_label: string | null;
};

function mapRow(row: DbRow): CallPartRow {
  return {
    ncode: row.ncode,
    nofficeid: row.nofficeid,
    callNo: row.call_no,
    visitNo: row.visit_no,
    visitAt: ymd(row.visit_at),
    partCategory: row.part_category,
    partCode: row.part_code,
    partName: row.part_name,
    qty: row.qty,
    oldBarcode: row.old_barcode,
    newBarcode: row.new_barcode,
    remarks: row.remarks,
    callLoggedAt: iso(row.call_logged_at),
    barcode: row.barcode,
    machineName: row.machine_name,
    modelCode: row.model_code,
    plantName: row.plant_name,
    branchName: row.branch_name,
    partyName: row.party_name,
    engineerName: row.engineer_name,
    clientName: row.client_name,
    city: row.city,
    statusLabel: row.status_label,
  };
}

export async function fetchCallPartsRows(filters: CallPartsFilters): Promise<CallPartsRowsResponse> {
  const { where, params } = buildCallPartsFilterSql(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const order = listOrder(filters.sort, filters.dir);
  const pageParams = [...params, filters.pageSize, offset];
  const pageSql = `SELECT p.ncode, p.nofficeid, p.call_no, p.visit_no, p.visit_at,
              ${CALL_PARTS_CATEGORY} AS part_category,
              p.part_code, p.part_name, p.qty,
              p.old_barcode, p.new_barcode, p.remarks,
              ${CALL_PARTS_HOT_COLS}
       ${CALL_PARTS_FROM}
       ${CALL_PARTS_CATEGORY_JOIN}
       WHERE ${where}
       ORDER BY ${order}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const [res, counted, state] = await Promise.all([
    withAppClient((client) => client.query<DbRow>(pageSql, pageParams)),
    withAppClient((client) =>
      client.query<{ total: number }>(
        `SELECT count(*)::int AS total ${CALL_PARTS_FROM} ${
          filters.category.trim() ? CALL_PARTS_CATEGORY_JOIN : ''
        } WHERE ${where}`,
        params
      )
    ),
    withAppClient((client) =>
      client.query<{ last_run_at: Date | null }>(`SELECT last_run_at FROM sync_state WHERE entity = $1`, [
        CALL_PARTS_ENTITY,
      ])
    ),
  ]);
  return {
    rows: res.rows.map(mapRow),
    total: counted.rows[0]?.total ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
    syncedAt: iso(state.rows[0]?.last_run_at ?? null),
  };
}

export async function fetchCallPartsOptions(filters: CallPartsFilters): Promise<CallPartsOptions> {
  const scoped: CallPartsFilters = {
    ...filters,
    search: '',
    plant: '',
    branch: '',
    client: '',
    customer: '',
    engineer: '',
    status: '',
    part: '',
    category: '',
  };
  const { where, params } = buildCallPartsFilterSql(scoped);
  const res = await withAppClient((client) =>
    client.query<{
      plants: string[] | null;
      branches: string[] | null;
      clients: string[] | null;
      engineers: string[] | null;
      statuses: string[] | null;
      categories: string[] | null;
    }>(
      `SELECT
         coalesce(array_agg(DISTINCT ${CALL_PARTS_PLANT}) FILTER (WHERE coalesce(${CALL_PARTS_PLANT}, '') <> ''), '{}') AS plants,
         coalesce(array_agg(DISTINCT ${CALL_PARTS_BRANCH}) FILTER (WHERE coalesce(${CALL_PARTS_BRANCH}, '') <> '' AND upper(${CALL_PARTS_BRANCH}) <> 'UNALLOCATED'), '{}') AS branches,
         coalesce(array_agg(DISTINCT ${CALL_PARTS_CLIENT}) FILTER (WHERE coalesce(${CALL_PARTS_CLIENT}, '') <> ''), '{}') AS clients,
         coalesce(array_agg(DISTINCT ${CALL_PARTS_ENGINEER}) FILTER (WHERE coalesce(${CALL_PARTS_ENGINEER}, '') <> ''), '{}') AS engineers,
         coalesce(array_agg(DISTINCT ${CALL_PARTS_STATUS}) FILTER (WHERE coalesce(${CALL_PARTS_STATUS}, '') <> ''), '{}') AS statuses,
         coalesce(array_agg(DISTINCT ${CALL_PARTS_CATEGORY}) FILTER (WHERE coalesce(${CALL_PARTS_CATEGORY}, '') <> ''), '{}') AS categories
       ${CALL_PARTS_FROM}
       ${CALL_PARTS_CATEGORY_JOIN}
       WHERE ${where}`,
      params
    )
  );
  const row = res.rows[0];
  const labels = (values: string[] | null) => (values ?? []).slice().sort((a, b) => a.localeCompare(b));
  return {
    plants: labels(row?.plants),
    branches: labels(row?.branches),
    clients: labels(row?.clients),
    engineers: labels(row?.engineers),
    statuses: labels(row?.statuses),
    categories: labels(row?.categories),
  };
}
