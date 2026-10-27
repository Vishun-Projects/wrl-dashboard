import { withAppClient, withBulkReadClient } from '@/lib/read-model/db';
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
  CALL_PARTS_SAP_AGG,
  CALL_PARTS_SAP_ATTACH,
  CALL_PARTS_SAP_CTE,
  CALL_PARTS_SAP_QTY_AGG,
  CALL_PARTS_STATUS,
  sapDocOuterSql,
  type CallPartsFilterInput,
} from '@/sql/call-visits/query';
import {
  daysDiffTechSolveCons,
  getCachedSapDocLookup,
  hasSapBarcodeMismatch,
  sapDocLookupCacheToken,
  type SapDocLookup,
  type SapDocPair,
} from '@/modules/call-visits/server/sap-doc';
import { CALL_PARTS_ENTITY } from '@/modules/call-visits/server/sync/postgres-sync';
import type { CallPartRow, CallPartsOptions, CallPartsRowsResponse } from '@/modules/call-visits/types';

const SCAN_FETCH = 5_000;
/** ponytail: enriched scan (JS sort / mismatch) reused across pages for ~60s. */
const SCAN_TTL_MS = 60_000;

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
  /** Post-lookup: only rows with any SAP↔MM barcode mismatch. */
  barcodeMismatch: boolean;
};

/** SQL-orderable columns (exist on call_parts / header joins). */
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
  /** Defective docs only — available via CALL_PARTS_SAP_* CTE. */
  sapDocDefective: 'sap_doc_defective',
  sapDocDefectiveQty: 'sap_doc_defective_qty',
} as const;

/**
 * Post-lookup fields — not in SQL page ORDER BY. Sorting these scans + sorts in memory
 * (cached per filter fingerprint).
 */
type JsSortKey = 'consDaysDiff' | 'sapDoc' | 'sapDocDefectiveReceipt' | 'sapDocDefectiveReceiptQty';

const JS_SORT_KEYS = new Set<string>([
  'consDaysDiff',
  'sapDoc',
  'sapDocDefectiveReceipt',
  'sapDocDefectiveReceiptQty',
]);

const SQL_SAP_SORT_KEYS = new Set<string>(['sapDocDefective', 'sapDocDefectiveQty']);

const SORT_KEYS = new Set<string>([...Object.keys(SORT_EXPR), ...JS_SORT_KEYS]);

export type CallPartSortKey = keyof typeof SORT_EXPR | JsSortKey;

function isJsSortKey(sort: CallPartSortKey | null): sort is JsSortKey {
  return sort != null && JS_SORT_KEYS.has(sort);
}

function listOrder(sort: CallPartSortKey | null, dir: 'asc' | 'desc'): string {
  const tail = 'p.call_no, p.visit_no, p.part_name, p.ncode';
  if (!sort || isJsSortKey(sort) || SQL_SAP_SORT_KEYS.has(sort as keyof typeof SORT_EXPR)) {
    return `h.logged_at DESC NULLS LAST, ${tail}`;
  }
  const sqlDir = dir === 'desc' ? 'DESC' : 'ASC';
  return `${SORT_EXPR[sort as keyof typeof SORT_EXPR]} ${sqlDir} NULLS LAST, ${tail}`;
}

const OUTER_SORT: Record<string, string> = {
  callNo: 'call_no',
  visitNo: 'visit_no',
  visitAt: 'visit_at',
  callLoggedAt: 'call_logged_at',
  plantName: 'plant_name',
  branchName: 'branch_name',
  clientName: 'client_name',
  partyName: 'party_name',
  city: 'city',
  statusLabel: 'status_label',
  engineerName: 'engineer_name',
  barcode: 'barcode',
  machineName: 'machine_name',
  modelCode: 'model_code',
  partCategory: 'part_category',
  partCode: 'part_code',
  partName: 'part_name',
  qty: 'qty',
  oldBarcode: 'old_barcode',
  newBarcode: 'new_barcode',
  remarks: 'remarks',
  sapDocDefective: 'sap_doc_defective',
  sapDocDefectiveQty: 'sap_doc_defective_qty',
};

function sapOrder(sort: CallPartSortKey | null, dir: 'asc' | 'desc'): string {
  const tail = 'call_no, visit_no, part_name, ncode';
  if (!sort || isJsSortKey(sort) || !OUTER_SORT[sort]) {
    return `call_logged_at DESC NULLS LAST, ${tail}`;
  }
  const sqlDir = dir === 'desc' ? 'DESC' : 'ASC';
  return `${OUTER_SORT[sort]} ${sqlDir} NULLS LAST, ${tail}`;
}

export function sapBaseSql(where: string): string {
  return `WITH ${CALL_PARTS_SAP_CTE},
    base AS (
      SELECT p.ncode, p.nofficeid, p.call_no, p.visit_no, p.visit_at,
             ${CALL_PARTS_CATEGORY} AS part_category,
             p.part_code, p.part_name, p.qty,
             p.old_barcode, p.new_barcode, p.remarks,
             NULLIF(btrim(h.franchisee_code), '') AS franchisee_code,
             ${CALL_PARTS_HOT_COLS},
             ${CALL_PARTS_SAP_AGG} AS sap_doc_defective,
             ${CALL_PARTS_SAP_QTY_AGG} AS sap_doc_defective_qty
      ${CALL_PARTS_FROM}
      ${CALL_PARTS_CATEGORY_JOIN}
      ${CALL_PARTS_SAP_ATTACH}
      WHERE ${where}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25
    )`;
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
  const pageSize = Math.min(250, Math.max(1, Number(searchParams.get('pageSize') ?? 250) || 250));
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
    sapDoc: searchParams.get('sapDoc')?.trim() ?? '',
    barcodeMismatch: searchParams.get('barcodeMismatch') === '1',
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
  franchisee_code: string | null;
  sap_doc?: string | null;
  sap_doc_defective?: string | null;
  sap_doc_defective_qty?: number | string | null;
};

function mapRow(row: DbRow, matched: SapDocPair | null = null, sapSql = false): CallPartRow {
  const visitAt = ymd(row.visit_at);
  return {
    ncode: row.ncode,
    nofficeid: row.nofficeid,
    callNo: row.call_no,
    visitNo: row.visit_no,
    visitAt,
    partCategory: row.part_category,
    partCode: row.part_code,
    partName: row.part_name,
    qty: row.qty,
    oldBarcode: row.old_barcode,
    newBarcode: row.new_barcode,
    consDaysDiff: daysDiffTechSolveCons(visitAt, matched?.sapDocPostingDate ?? null),
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
    sapDoc: matched?.sapDoc ?? null,
    sapDocDefective: sapSql
      ? (row.sap_doc_defective ?? null)
      : (matched?.sapDocDefective ?? null),
    sapDocDefectiveQty: sapSql
      ? formatSapQty(row.sap_doc_defective_qty)
      : (matched?.sapDocDefectiveQty ?? null),
    sapDocDefectiveReceipt: matched?.sapDocDefectiveReceipt ?? null,
    sapDocDefectiveReceiptQty: matched?.sapDocDefectiveReceiptQty ?? null,
    sapDocBarcode: matched?.sapDocBarcode ?? null,
    sapDocBarcodeMismatch: matched?.sapDocBarcodeMismatch ?? false,
    sapDocDefectiveBarcode: matched?.sapDocDefectiveBarcode ?? null,
    sapDocDefectiveBarcodeMismatch: matched?.sapDocDefectiveBarcodeMismatch ?? false,
    sapDocDefectiveReceiptBarcode: matched?.sapDocDefectiveReceiptBarcode ?? null,
    sapDocDefectiveReceiptBarcodeMismatch: matched?.sapDocDefectiveReceiptBarcodeMismatch ?? false,
  };
}

function formatSapQty(value: number | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : String(n);
}

function usesSapSql(filters: CallPartsFilters): boolean {
  return (
    Boolean(filters.sapDoc.trim()) ||
    filters.sort === 'sapDocDefective' ||
    filters.sort === 'sapDocDefectiveQty'
  );
}

function needsEnrichedScan(filters: CallPartsFilters): boolean {
  return filters.barcodeMismatch || isJsSortKey(filters.sort);
}

function jsSortValue(row: CallPartRow, key: JsSortKey): string | number | null {
  switch (key) {
    case 'consDaysDiff':
      return row.consDaysDiff;
    case 'sapDoc':
      return row.sapDoc;
    case 'sapDocDefectiveReceipt':
      return row.sapDocDefectiveReceipt;
    case 'sapDocDefectiveReceiptQty': {
      if (row.sapDocDefectiveReceiptQty == null || row.sapDocDefectiveReceiptQty === '') return null;
      const n = Number(row.sapDocDefectiveReceiptQty);
      return Number.isFinite(n) ? n : row.sapDocDefectiveReceiptQty;
    }
  }
}

function sortEnriched(rows: CallPartRow[], key: JsSortKey, dir: 'asc' | 'desc'): void {
  const mul = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = jsSortValue(a, key);
    const bv = jsSortValue(b, key);
    const aEmpty = av == null || av === '';
    const bEmpty = bv == null || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * mul;
  });
}

function scanFingerprint(filters: CallPartsFilters): string {
  return JSON.stringify({
    allTime: filters.allTime,
    startDate: filters.startDate,
    endDate: filters.endDate,
    search: filters.search,
    plant: filters.plant,
    branch: filters.branch,
    client: filters.client,
    customer: filters.customer,
    engineer: filters.engineer,
    status: filters.status,
    part: filters.part,
    category: filters.category,
    sapDoc: filters.sapDoc,
    barcodeMismatch: filters.barcodeMismatch,
    sort: filters.sort,
    dir: filters.dir,
    isHod: filters.isHod,
    assignedOffices: filters.assignedOffices,
  });
}

type ScanCache = {
  key: string;
  rows: CallPartRow[];
  syncedAt: string | null;
  at: number;
};
let scanCache: ScanCache | null = null;

function matchPart(lookup: SapDocLookup, row: DbRow): SapDocPair {
  return lookup.match({
    callNo: row.call_no,
    plantName: row.plant_name,
    franchiseeCode: row.franchisee_code,
    partCategory: row.part_category,
    partCode: row.part_code,
    newBarcode: row.new_barcode,
    oldBarcode: row.old_barcode,
  });
}

async function scanEnrichedRows(filters: CallPartsFilters): Promise<{
  rows: CallPartRow[];
  syncedAt: string | null;
}> {
  await getCachedSapDocLookup();
  const keyPrefix = scanFingerprint(filters);
  const cachedKey = `${keyPrefix}|${sapDocLookupCacheToken() ?? ''}`;
  if (scanCache && scanCache.key === cachedKey && Date.now() - scanCache.at < SCAN_TTL_MS) {
    return { rows: scanCache.rows, syncedAt: scanCache.syncedAt };
  }

  const { where, params } = buildCallPartsFilterSql(filters);
  const sap = usesSapSql(filters);
  const sapFilter = Boolean(filters.sapDoc.trim());
  const order = listOrder(isJsSortKey(filters.sort) ? null : filters.sort, filters.dir);
  const cursorParams = [...params];
  const sapOuter = sapFilter ? sapDocOuterSql(filters.sapDoc, cursorParams) : '';
  const cursorSql = sap
    ? `${sapBaseSql(where)}
       SELECT * FROM base
       WHERE ${sapOuter || 'TRUE'}
       ORDER BY ${sapOrder(isJsSortKey(filters.sort) ? null : filters.sort, filters.dir)}`
    : `SELECT p.ncode, p.nofficeid, p.call_no, p.visit_no, p.visit_at,
              ${CALL_PARTS_CATEGORY} AS part_category,
              p.part_code, p.part_name, p.qty,
              p.old_barcode, p.new_barcode, p.remarks,
              NULLIF(btrim(h.franchisee_code), '') AS franchisee_code,
              ${CALL_PARTS_HOT_COLS}
       ${CALL_PARTS_FROM}
       ${CALL_PARTS_CATEGORY_JOIN}
       WHERE ${where}
       ORDER BY ${order}`;

  const [rows, state] = await Promise.all([
    withBulkReadClient(async (client) => {
      const lookup = await getCachedSapDocLookup(client);
      const out: CallPartRow[] = [];
      await client.query('BEGIN');
      try {
        await client.query(`DECLARE call_parts_scan NO SCROLL CURSOR FOR ${cursorSql}`, cursorParams);
        for (;;) {
          const res = await client.query<DbRow>(`FETCH ${SCAN_FETCH} FROM call_parts_scan`);
          if (res.rows.length === 0) break;
          for (const row of res.rows) {
            const matched = matchPart(lookup, row);
            if (filters.barcodeMismatch && !hasSapBarcodeMismatch(matched)) continue;
            out.push(mapRow(row, matched, sapFilter));
          }
          if (res.rows.length < SCAN_FETCH) break;
        }
        await client.query('CLOSE call_parts_scan');
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      }
      return out;
    }),
    withAppClient((client) =>
      client.query<{ last_run_at: Date | null }>(`SELECT last_run_at FROM sync_state WHERE entity = $1`, [
        CALL_PARTS_ENTITY,
      ])
    ),
  ]);

  if (isJsSortKey(filters.sort)) sortEnriched(rows, filters.sort, filters.dir);
  const syncedAt = iso(state.rows[0]?.last_run_at ?? null);
  scanCache = {
    key: `${keyPrefix}|${sapDocLookupCacheToken() ?? ''}`,
    rows,
    syncedAt,
    at: Date.now(),
  };
  return { rows, syncedAt };
}

async function fetchEnrichedScanPage(filters: CallPartsFilters): Promise<CallPartsRowsResponse> {
  const { rows, syncedAt } = await scanEnrichedRows(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  return {
    rows: rows.slice(offset, offset + filters.pageSize),
    total: rows.length,
    page: filters.page,
    pageSize: filters.pageSize,
    syncedAt,
  };
}

export async function fetchCallPartsRows(filters: CallPartsFilters): Promise<CallPartsRowsResponse> {
  if (needsEnrichedScan(filters)) return fetchEnrichedScanPage(filters);

  const { where, params } = buildCallPartsFilterSql(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const order = listOrder(filters.sort, filters.dir);
  const sap = usesSapSql(filters);
  const sapFilter = Boolean(filters.sapDoc.trim());
  const pageParams = [...params, filters.pageSize, offset];
  const sapOuter = sapDocOuterSql(filters.sapDoc, pageParams);
  const countParams = [...params];
  const countOuter = sapDocOuterSql(filters.sapDoc, countParams);
  const pageSql = sap
    ? `${sapBaseSql(where)}
       SELECT * FROM base
       ${sapOuter ? `WHERE ${sapOuter}` : ''}
       ORDER BY ${sapOrder(filters.sort, filters.dir)}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    : `SELECT p.ncode, p.nofficeid, p.call_no, p.visit_no, p.visit_at,
              ${CALL_PARTS_CATEGORY} AS part_category,
              p.part_code, p.part_name, p.qty,
              p.old_barcode, p.new_barcode, p.remarks,
              NULLIF(btrim(h.franchisee_code), '') AS franchisee_code,
              ${CALL_PARTS_HOT_COLS}
       ${CALL_PARTS_FROM}
       ${CALL_PARTS_CATEGORY_JOIN}
       WHERE ${where}
       ORDER BY ${order}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const [res, counted, state, lookup] = await Promise.all([
    withAppClient((client) => client.query<DbRow>(pageSql, pageParams)),
    withAppClient((client) =>
      client.query<{ total: number }>(
        sapFilter
          ? `${sapBaseSql(where)} SELECT count(*)::int AS total FROM base ${countOuter ? `WHERE ${countOuter}` : ''}`
          : `SELECT count(*)::int AS total ${CALL_PARTS_FROM} ${
              filters.category.trim() ? CALL_PARTS_CATEGORY_JOIN : ''
            } WHERE ${where}`,
        sapFilter ? countParams : params
      )
    ),
    withAppClient((client) =>
      client.query<{ last_run_at: Date | null }>(`SELECT last_run_at FROM sync_state WHERE entity = $1`, [
        CALL_PARTS_ENTITY,
      ])
    ),
    getCachedSapDocLookup(),
  ]);
  return {
    rows: res.rows.map((row) => mapRow(row, matchPart(lookup, row), sapFilter)),
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
    sapDoc: '',
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
