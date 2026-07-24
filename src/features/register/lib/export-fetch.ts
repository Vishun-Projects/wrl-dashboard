import axios from 'axios';
import { readRegisterFromPostgresClient } from '@/lib/read-model/client-flags';
import { downloadRegisterCsvInBrowser } from './server/csv-export';
import {
  blobToPreparedExport,
  triggerBlobDownload,
  type PreparedFileExport,
} from '@/features/report/download';import { fetchWithRetry, withAxiosRetry } from '@/lib/net/fetch-with-retry';

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

export type RegisterExportProgress = {
  fetched: number;
  total: number;
  detail?: string;
};

export type RegisterExportKeysetCursor = {
  cursorLoggedAt?: string;
  cursorNcode?: number;
};

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
  repair?: string;
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
  cursor?: RegisterExportKeysetCursor
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
  setOptional(params, 'repair', query.repair);
  setOptional(params, 'account', query.account);
  setOptional(params, 'region', query.region);
  if (cursor?.cursorLoggedAt && cursor.cursorNcode != null && cursor.cursorNcode > 0) {
    params.set('cursorLoggedAt', cursor.cursorLoggedAt);
    params.set('cursorNcode', String(cursor.cursorNcode));
  }
  return params;
}

export function registerExportCursorFromRow(
  row: Record<string, unknown>,
  dateFilterColumn?: string | null
): RegisterExportKeysetCursor | null {
  const useSolved = dateFilterColumn === 'dsolvedatetime';
  const dateVal = useSolved
    ? row.callsolveddate ?? row.solved_at
    : row.callsdtrndate ?? row.logged_at;
  const ncode = Number(row.ncode ?? row.id);
  if (dateVal == null || !Number.isFinite(ncode) || ncode <= 0) return null;
  const cursorLoggedAt =
    dateVal instanceof Date ? dateVal.toISOString() : String(dateVal);
  return { cursorLoggedAt, cursorNcode: ncode };
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
export async function downloadRegisterCsvFromRows(
  rows: Record<string, unknown>[],
  filename?: string
): Promise<void> {
  await downloadRegisterCsvInBrowser(rows, filename);
}

/** Count `\n` in a byte chunk (CSV rows end with `\r\n` or `\n`). */
export function countNewlinesInBytes(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) n++;
  }
  return n;
}

/**
 * Data rows in a BOM + header + body CSV stream.
 * newlines = 1 (header) + dataRows when every line ends with `\n`.
 */
export function csvDataRowsFromNewlineCount(newlines: number): number {
  return Math.max(0, newlines - 1);
}

/** Throw when a truncated/proxy-cut stream delivered fewer rows than promised. */
export function assertRegisterCsvExportComplete(dataRows: number, exportTotal: number): void {
  if (exportTotal > 0 && dataRows < exportTotal) {
    throw new Error(
      `Export incomplete — got ${dataRows.toLocaleString()} of ${exportTotal.toLocaleString()} rows. Retry the export.`
    );
  }
}

/**
 * Prefer VPS host when explicitly enabled and MIS upload URL is set.
 * Default stays same-origin — VPS needs Caddy `register-export` + mis-upload restart,
 * otherwise api.wrl-fsm.cloud returns 401 from the wrong upstream.
 */
export function resolveRegisterCsvExportUrl(params: URLSearchParams): {
  url: string;
  external: boolean;
} {
  const repair = params.get('repair') || '';
  const hasRepair = Boolean(repair && repair !== 'All');
  const vpsEnabled = process.env.NEXT_PUBLIC_REGISTER_CSV_VPS === '1';
  const external = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim();
  if (vpsEnabled && external && !hasRepair) {
    const base = external.replace(/\/api\/mis-client-import\/upload\/?$/i, '');
    return {
      url: `${base}/api/report/register-export?${params.toString()}`,
      external: true,
    };
  }
  return { url: `/api/report?${params.toString()}`, external: false };
}

function sameOriginRegisterCsvUrl(params: URLSearchParams): string {
  return `/api/report?${params.toString()}`;
}

/** Statuses that mean the VPS export host is unreachable / not wired — fall back to Vercel. */
function shouldFallbackRegisterCsvToSameOrigin(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 502 || status === 503;
}

async function readRegisterCsvExportBody(
  res: Response,
  exportTotal: number,
  onProgress?: (progress: RegisterExportProgress) => void
): Promise<PreparedFileExport> {
  const contentType = String(res.headers.get('content-type') ?? '');
  if (contentType.includes('application/json')) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || 'Server returned JSON instead of CSV');
  }

  const headerTotal = Number(res.headers.get('X-Register-Export-Total') ?? 0);
  const total = headerTotal > 0 ? headerTotal : exportTotal;

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Export response has no body');
  }

  const chunks: Uint8Array[] = [];
  let newlines = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;

    chunks.push(value);
    newlines += countNewlinesInBytes(value);

    if (total > 0) {
      const fetched = Math.min(total, csvDataRowsFromNewlineCount(newlines));
      onProgress?.({ fetched, total });
    }
  }

  const dataRows = csvDataRowsFromNewlineCount(newlines);
  assertRegisterCsvExportComplete(dataRows, total);

  onProgress?.({
    fetched: total > 0 ? total : dataRows,
    total: total > 0 ? total : dataRows,
  });

  const blob = new Blob(chunks as BlobPart[], { type: 'text/csv;charset=utf-8;' });
  const baseName = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  return blobToPreparedExport(blob, baseName);
}

/** Stream register CSV from server into a prepared export blob (single server path). */
export async function prepareRegisterCsvFromServer(opts: {
  query: RegisterExportQuery;
  knownTotal?: number;
  signal?: AbortSignal;
  accessToken?: string | null;
  onProgress?: (progress: RegisterExportProgress) => void;
}): Promise<PreparedFileExport> {
  const params = buildRegisterExportParams(opts.query, 1, REGISTER_EXPORT_BATCH_CRM, false);
  params.set('export', 'csv');

  const fallbackTotal = Math.max(0, opts.knownTotal ?? 0);
  opts.onProgress?.({ fetched: 0, total: fallbackTotal });

  const resolved = resolveRegisterCsvExportUrl(params);
  // No bearer → stay on same-origin cookies (VPS path is not ready without a token).
  const useExternal = resolved.external && Boolean(opts.accessToken?.trim());

  const tryFetch = async (url: string, external: boolean): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (external && opts.accessToken) {
      headers.Authorization = `Bearer ${opts.accessToken}`;
    }
    return fetchWithRetry(url, {
      credentials: external ? 'omit' : 'include',
      signal: opts.signal,
      headers,
    });
  };

  let res = await tryFetch(
    useExternal ? resolved.url : sameOriginRegisterCsvUrl(params),
    useExternal
  );

  if (
    useExternal &&
    !res.ok &&
    shouldFallbackRegisterCsvToSameOrigin(res.status)
  ) {
    // VPS route missing / JWT env not loaded / Caddy still proxying to the wrong app.
    res = await tryFetch(sameOriginRegisterCsvUrl(params), false);
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Export failed (${res.status}). Retry in a moment.`);
  }

  return readRegisterCsvExportBody(res, fallbackTotal, opts.onProgress);
}

/** One server request: streams CSV; reports row progress while bytes arrive. */
export async function downloadRegisterCsvFromServer(opts: {
  query: RegisterExportQuery;
  knownTotal?: number;
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<void> {
  const prepared = await prepareRegisterCsvFromServer({
    ...opts,
    onProgress: opts.onProgress
      ? ({ fetched, total }) => opts.onProgress!(fetched, total)
      : undefined,
  });
  await triggerBlobDownload(prepared.blob, prepared.filename);
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
    res = await withAxiosRetry(() =>
      axios.get(url, { withCredentials: true, signal: opts.signal })
    );
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
  cursor?: RegisterExportKeysetCursor
) {
  const params = buildRegisterExportParams(query, page, batchSize, fetchTotals, cursor);
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
    return fetchRegisterKeysetPagesForExport(opts);
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
  let cursor: RegisterExportKeysetCursor | undefined;

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
      cursor
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

    const nextCursor = registerExportCursorFromRow(
      rows[rows.length - 1]!,
      opts.query.dateFilterColumn
    );
    if (nextCursor) {
      cursor = nextCursor;
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

/** Postgres composite keyset pages for in-browser small exports only. */
async function fetchRegisterKeysetPagesForExport(opts: {
  query: RegisterExportQuery;
  knownTotal?: number;
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Record<string, unknown>[]> {
  const batchSize = REGISTER_EXPORT_BATCH_POSTGRES;
  const t0 = performance.now();
  logRegisterBulk('postgres keyset preload START', {
    batchSize,
    startDate: opts.query.startDate,
    endDate: opts.query.endDate,
  });

  const allRows: Record<string, unknown>[] = [];
  let total = Math.max(0, opts.knownTotal ?? 0);
  let cursor: RegisterExportKeysetCursor | undefined;
  let page = 0;

  while (true) {
    if (opts.signal?.aborted) {
      throw new axios.Cancel('Register export cancelled');
    }

    page += 1;
    const fetchTotals = page === 1 && total <= 0;
    const pageStart = performance.now();
    const res = await fetchRegisterExportPage(
      opts.query,
      page,
      batchSize,
      fetchTotals,
      opts.signal,
      cursor
    );

    if (fetchTotals) {
      total = Number(res.data?.total ?? 0);
    }

    const rows = (res.data?.data ?? []) as Record<string, unknown>[];
    if (!rows.length) break;

    allRows.push(...rows);
    opts.onProgress?.(allRows.length, total);
    logRegisterBulk(`postgres keyset page ${page}`, {
      pageRows: rows.length,
      fetched: allRows.length,
      total: total || 'unknown',
      pageMs: Number((performance.now() - pageStart).toFixed(1)),
    });

    const nextCursor = registerExportCursorFromRow(
      rows[rows.length - 1]!,
      opts.query.dateFilterColumn
    );
    if (!nextCursor) break;
    cursor = nextCursor;

    if (total > 0 && allRows.length >= total) break;
    if (rows.length < batchSize) break;
  }

  logRegisterBulk('postgres keyset preload DONE (network)', {
    rows: allRows.length,
    pages: page,
    ms: Number((performance.now() - t0).toFixed(1)),
  });
  return allRows;
}
