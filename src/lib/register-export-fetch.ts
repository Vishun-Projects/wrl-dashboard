import axios from 'axios';
import { isWithinHotWindow } from '@/lib/read-model/hot-window';
import { readRegisterFromPostgresClient } from '@/lib/read-model/client-flags';

export function isRegisterExportAbortError(err: unknown): boolean {
  if (axios.isCancel(err)) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ERR_CANCELED') {
    return true;
  }
  return false;
}

/** Batch size for CRM paginated fetches (server export uses keyset internally). */
export const REGISTER_EXPORT_BATCH_CRM = 1000;
/** Larger batches when the API serves from Postgres hot table. */
export const REGISTER_EXPORT_BATCH_POSTGRES = 2000;

const REGISTER_LOG_PREFIX = '[WRL Register]';

function registerLog(message: string, extra?: Record<string, unknown>) {
  if (typeof console === 'undefined') return;
  if (extra) {
    console.log(REGISTER_LOG_PREFIX, message, extra);
  } else {
    console.log(REGISTER_LOG_PREFIX, message);
  }
}

export function logRegisterBulk(message: string, extra?: Record<string, unknown>) {
  registerLog(message, extra);
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

export function resolveRegisterExportBatchSize(startDate: string, endDate: string): number {
  if (readRegisterFromPostgresClient() && isWithinHotWindow(startDate, endDate)) {
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

/** One server request: streams CSV using keyset pagination (no slow OFFSET in browser). */
export async function downloadRegisterCsvFromServer(opts: {
  getAuthHeaders: () => Promise<Record<string, string>>;
  refreshAuth?: () => Promise<void>;
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

  const attempt = async () => {
    const headers = await opts.getAuthHeaders();
    return axios.get(`/api/report?${params.toString()}`, {
      headers,
      signal: opts.signal,
      responseType: 'blob',
    });
  };

  let res;
  try {
    if (opts.refreshAuth) await opts.refreshAuth();
    res = await attempt();
  } catch (err) {
    if (!axios.isAxiosError(err) || err.response?.status !== 401 || !opts.refreshAuth) {
      throw err;
    }
    await opts.refreshAuth();
    res = await attempt();
  }

  opts.onProgress?.(total > 0 ? total : 1, total > 0 ? total : 1);

  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
  const filename = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function fetchRegisterBulkForCache(opts: {
  getAuthHeaders: () => Promise<Record<string, string>>;
  refreshAuth?: () => Promise<void>;
  query: RegisterExportQuery;
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Record<string, unknown>[]> {
  const t0 = performance.now();
  registerLog('bulk preload START (single API request)', {
    startDate: opts.query.startDate,
    endDate: opts.query.endDate,
    callType: opts.query.callType,
  });

  const params = buildRegisterExportParams(opts.query, 1, 1, false);
  params.set('export', 'bulk');
  const url = `/api/report?${params.toString()}`;

  const attempt = async () => {
    const headers = await opts.getAuthHeaders();
    return axios.get(url, { headers, signal: opts.signal });
  };

  if (opts.refreshAuth) await opts.refreshAuth();
  let res;
  try {
    res = await attempt();
  } catch (err) {
    if (!axios.isAxiosError(err) || err.response?.status !== 401 || !opts.refreshAuth) {
      registerLog('bulk preload FAILED', {
        ms: Number((performance.now() - t0).toFixed(1)),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    await opts.refreshAuth();
    res = await attempt();
  }

  const rows = (res.data?.data ?? []) as Record<string, unknown>[];
  opts.onProgress?.(rows.length, rows.length);
  registerLog('bulk preload DONE (network)', {
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
  getAuthHeaders: () => Promise<Record<string, string>>,
  refreshAuth: (() => Promise<void>) | undefined,
  signal: AbortSignal | undefined,
  cursorNcode?: number
) {
  const params = buildRegisterExportParams(query, page, batchSize, fetchTotals, cursorNcode);
  const url = `/api/report?${params.toString()}`;

  const attempt = async () => {
    const headers = await getAuthHeaders();
    return axios.get(url, { headers, signal });
  };

  try {
    return await attempt();
  } catch (err) {
    if (!axios.isAxiosError(err) || err.response?.status !== 401 || !refreshAuth) {
      throw err;
    }
    await refreshAuth();
    return attempt();
  }
}

/** Legacy multi-page JSON fetch (small exports / detailed breakdown). */
export async function fetchAllRegisterRowsForExport(opts: {
  getAuthHeaders: () => Promise<Record<string, string>>;
  refreshAuth?: () => Promise<void>;
  query: RegisterExportQuery;
  knownTotal?: number;
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Record<string, unknown>[]> {
  if (readRegisterFromPostgresClient() && isWithinHotWindow(opts.query.startDate, opts.query.endDate)) {
    return fetchRegisterBulkForCache(opts);
  }

  const batchSize = resolveRegisterExportBatchSize(opts.query.startDate, opts.query.endDate);
  const t0 = performance.now();
  registerLog('paginated preload START', {
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
    if (page === 1 || page % 10 === 0) {
      await opts.refreshAuth?.();
    }
    const pageStart = performance.now();
    const res = await fetchRegisterExportPage(
      opts.query,
      page,
      batchSize,
      fetchTotals,
      opts.getAuthHeaders,
      opts.refreshAuth,
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
    registerLog(`paginated preload page ${page}`, {
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

  registerLog('paginated preload DONE (network)', {
    rows: allRows.length,
    pages: page,
    ms: Number((performance.now() - t0).toFixed(1)),
  });
  return allRows;
}
