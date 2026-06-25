import axios from 'axios';
import { readRegisterFromPostgresClient } from '@/lib/read-model/client-flags';
import { downloadRegisterCsvInBrowser } from './server/csv-export';

export function isRegisterExportAbortError(err: unknown): boolean {
  if (axios.isCancel(err)) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ERR_CANCELED') {
    return true;
  }
  return false;
}

/** Above this count, paginated browser fetch is avoided — server streams CSV in one request. */
export const REGISTER_SERVER_STREAM_MIN_ROWS = 500;

export function shouldStreamRegisterExportFromServer(
  knownTotal: number,
  cachedRowCount: number
): boolean {
  if (cachedRowCount > 0 && knownTotal > 0 && cachedRowCount >= knownTotal) {
    return false;
  }
  if (knownTotal <= 0) return true;
  return knownTotal > REGISTER_SERVER_STREAM_MIN_ROWS;
}

/** Batch size for CRM paginated fetches (server export uses keyset internally). */
export const REGISTER_EXPORT_BATCH_CRM = 1000;
/** Larger batches when the API serves from Postgres hot table. */
export const REGISTER_EXPORT_BATCH_POSTGRES = 2000;

export function logRegisterBulk(_message: string, _extra?: Record<string, unknown>) {
  /* no-op — avoid leaking load paths in the browser console */
}

export type RegisterExportQuery = {
  officeId: string;
  callType: string;
  startDate: string;
  endDate: string;
  dateFilterColumn: string;
  search?: string;
  pincode?: string;
  state?: string;
  city?: string;
  branch?: string;
  franchisee?: string;
  technician?: string;
  status?: string;
  priority?: string;
  portalFilter?: string;
  account?: string;
  region?: string;
};

function setOptional(params: URLSearchParams, key: string, value?: string) {
  if (value) params.set(key, value);
}

export function buildRegisterExportParams(
  query: RegisterExportQuery,
  page: number,
  limit: number,
  fetchTotals: boolean,
  cursorNcode?: number
): URLSearchParams {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    officeId: query.officeId,
    callType: query.callType,
    startDate: query.startDate,
    endDate: query.endDate,
    dateFilterColumn: query.dateFilterColumn,
  });
  if (!fetchTotals) params.set('fetchTotals', 'false');
  params.set('fetchFilterOptions', 'false');
  setOptional(params, 'search', query.search);
  setOptional(params, 'pincode', query.pincode);
  setOptional(params, 'state', query.state);
  setOptional(params, 'city', query.city);
  setOptional(params, 'branch', query.branch);
  setOptional(params, 'franchisee', query.franchisee);
  setOptional(params, 'technician', query.technician);
  setOptional(params, 'status', query.status);
  setOptional(params, 'priority', query.priority);
  setOptional(params, 'portalFilter', query.portalFilter);
  setOptional(params, 'account', query.account);
  setOptional(params, 'region', query.region);
  if (cursorNcode != null && cursorNcode > 0) {
    params.set('cursorNcode', String(cursorNcode));
  }
  return params;
}

export function resolveRegisterExportBatchSize(_startDate: string, _endDate: string): number {
  if (readRegisterFromPostgresClient()) {
    return REGISTER_EXPORT_BATCH_POSTGRES;
  }
  return REGISTER_EXPORT_BATCH_CRM;
}

/** Use in-memory register pages (grid pagination) when every page is already cached. */
export function collectRegisterRowsFromSessionCache(
  root: Map<string, Map<number, { data?: unknown[] }>>,
  queryKey: string,
  total: number,
  pageLimit: number
): Record<string, unknown>[] | null {
  if (total <= 0 || pageLimit <= 0) return null;
  const inner = root.get(queryKey);
  if (!inner) return null;

  const totalPages = Math.ceil(total / pageLimit);
  const rows: Record<string, unknown>[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const entry = inner.get(p);
    if (!entry?.data?.length) return null;
    rows.push(...(entry.data as Record<string, unknown>[]));
  }

  return rows.length >= total ? rows.slice(0, total) : null;
}

/** Download register rows as a proper CSV file in the browser. */
export function downloadRegisterCsvFromRows(
  rows: Record<string, unknown>[],
  filename?: string
): void {
  downloadRegisterCsvInBrowser(rows, filename);
}

/** One server request: streams CSV using keyset pagination (no slow OFFSET in browser). */
export async function downloadRegisterCsvFromServer(opts: {
  query: RegisterExportQuery;
  knownTotal?: number;
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<void> {
  const params = buildRegisterExportParams(opts.query, 1, REGISTER_EXPORT_BATCH_CRM, false);
  params.set('export', 'csv');
  if (opts.knownTotal != null && opts.knownTotal > 0) {
    params.set('knownTotal', String(opts.knownTotal));
  }

  const total = Math.max(0, opts.knownTotal ?? 0);
  opts.onProgress?.(0, total);

  const res = await axios.get(`/api/report?${params.toString()}`, {
    withCredentials: true,
    signal: opts.signal,
    responseType: 'blob',
    timeout: 600_000,
  });

  opts.onProgress?.(total > 0 ? total : 1, total > 0 ? total : 1);

  const contentType = String(res.headers['content-type'] ?? '');
  const blobData = res.data as Blob;
  const rawText = await blobData.text();
  const trimmed = rawText.trimStart();
  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let message = 'Server returned JSON instead of CSV';
    try {
      const parsed = JSON.parse(trimmed) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }

  const blob = new Blob(['\uFEFF', rawText], { type: 'text/csv;charset=utf-8;' });
  const filename = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function fetchRegisterBulkForCache(opts: {
  query: RegisterExportQuery;
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Record<string, unknown>[]> {
  const t0 = performance.now();
  logRegisterBulk('bulk preload START (single API request)', {
    startDate: opts.query.startDate,
    endDate: opts.query.endDate,
    callType: opts.query.callType,
  });

  const params = buildRegisterExportParams(opts.query, 1, 1, false);
  params.set('export', 'bulk');
  const url = `/api/report?${params.toString()}`;

  let res;
  try {
    res = await axios.get(url, { withCredentials: true, signal: opts.signal });
  } catch (err) {
    logRegisterBulk('bulk preload FAILED', {
      ms: Number((performance.now() - t0).toFixed(1)),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const rows = (res.data?.data ?? []) as Record<string, unknown>[];
  if (!Array.isArray(rows)) {
    throw new Error('Invalid register bulk response from server');
  }
  opts.onProgress?.(rows.length, rows.length);
  logRegisterBulk('bulk preload DONE (network)', {
    rows: rows.length,
    ms: Number((performance.now() - t0).toFixed(1)),
  });
  return rows;
}

async function fetchRegisterExportPage(
  query: RegisterExportQuery,
  page: number,
  batchSize: number,
  fetchTotals: boolean,
  signal: AbortSignal | undefined,
  cursorNcode?: number
) {
  const params = buildRegisterExportParams(query, page, batchSize, fetchTotals, cursorNcode);
  const url = `/api/report?${params.toString()}`;
  return axios.get(url, { withCredentials: true, signal });
}

/** Legacy multi-page JSON fetch (small exports / detailed breakdown). */
export async function fetchAllRegisterRowsForExport(opts: {
  query: RegisterExportQuery;
  knownTotal?: number;
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Record<string, unknown>[]> {
  if (readRegisterFromPostgresClient()) {
    return fetchRegisterBulkForCache(opts);
  }

  const batchSize = resolveRegisterExportBatchSize(opts.query.startDate, opts.query.endDate);
  const t0 = performance.now();
  logRegisterBulk('paginated preload START', {
    batchSize,
    startDate: opts.query.startDate,
    endDate: opts.query.endDate,
  });
  const allRows: Record<string, unknown>[] = [];
  let total = Math.max(0, opts.knownTotal ?? 0);
  let page = 1;
  let cursorNcode: number | undefined;

  while (true) {
    if (opts.signal?.aborted) {
      throw new axios.Cancel('Register export cancelled');
    }

    const fetchTotals = page === 1 && total <= 0;
    const pageStart = performance.now();
    const res = await fetchRegisterExportPage(
      opts.query,
      page,
      batchSize,
      fetchTotals,
      opts.signal,
      cursorNcode
    );

    if (fetchTotals) {
      total = Number(res.data?.total ?? 0);
    }

    const rows = (res.data?.data ?? []) as Record<string, unknown>[];
    if (!rows.length) break;

    allRows.push(...rows);
    opts.onProgress?.(allRows.length, total);
    logRegisterBulk(`paginated preload page ${page}`, {
      pageRows: rows.length,
      fetched: allRows.length,
      total: total || 'unknown',
      pageMs: Number((performance.now() - pageStart).toFixed(1)),
    });

    const lastNcode = Number(rows[rows.length - 1]?.id ?? rows[rows.length - 1]?.ncode);
    if (Number.isFinite(lastNcode) && lastNcode > 0) {
      cursorNcode = lastNcode;
    }

    if (total > 0 && allRows.length >= total) break;
    if (rows.length < batchSize) break;
    page += 1;
  }

  logRegisterBulk('paginated preload DONE (network)', {
    rows: allRows.length,
    pages: page,
    ms: Number((performance.now() - t0).toFixed(1)),
  });
  return allRows;
}
