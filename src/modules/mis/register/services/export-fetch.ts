import axios from 'axios';
import { readRegisterFromPostgresClient } from '@/lib/read-model/client-flags';
import { downloadRegisterCsvInBrowser } from '../server/csv-export';
import {
  blobToPreparedExport,
  triggerBlobDownload,
  type PreparedFileExport,
} from '@/modules/mis/download';import { fetchWithRetry } from '@/lib/net/fetch-with-retry';

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

export function logRegisterBulk(message: string, extra?: Record<string, unknown>) {
  void message;
  void extra;
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
  const useBm = dateFilterColumn === 'bm_approved_at';
  const dateVal = useBm
    ? row.bm_approved_at ?? row.bm_approved_date
    : useSolved
      ? row.callsolveddate ?? row.solved_at
      : row.callsdtrndate ?? row.logged_at;
  const ncode = Number(row.ncode ?? row.id);
  if (dateVal == null || !Number.isFinite(ncode) || ncode <= 0) return null;
  const cursorLoggedAt =
    dateVal instanceof Date ? dateVal.toISOString() : String(dateVal);
  return { cursorLoggedAt, cursorNcode: ncode };
}

export function resolveRegisterExportBatchSize(startDate: string, endDate: string): number {
  void startDate;
  void endDate;
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
 * Large exports use parallel same-origin date shards by default (avoids long-stream kills).
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

/** Split a YYYY-MM-DD range into inclusive week-sized shards (Mon–Sun-ish by +6 days). */
export function splitRegisterExportDateShards(
  startDate: string,
  endDate: string,
  opts?: { maxDaysPerShard?: number }
): Array<{ startDate: string; endDate: string }> {
  const maxDays = Math.max(1, opts?.maxDaysPerShard ?? 7);
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (!start || !end || end < start) {
    return [{ startDate, endDate }];
  }

  const shards: Array<{ startDate: string; endDate: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const shardEnd = addDays(cursor, maxDays - 1);
    const clamped = shardEnd > end ? end : shardEnd;
    shards.push({ startDate: formatYmd(cursor), endDate: formatYmd(clamped) });
    cursor = addDays(clamped, 1);
  }
  return shards.length ? shards : [{ startDate, endDate }];
}

function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Skip UTF-8 BOM + first CSV line (header) so shards can be concatenated. */
export function stripCsvBomAndHeader(bytes: Uint8Array): Uint8Array {
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  let i = offset;
  while (i < bytes.length && bytes[i] !== 10) i++;
  if (i < bytes.length && bytes[i] === 10) i++;
  return bytes.subarray(i);
}

const REGISTER_CSV_SHARD_ROW_THRESHOLD = 20_000;
const REGISTER_CSV_SHARD_CONCURRENCY = 6;

async function fetchOneRegisterCsvShard(opts: {
  query: RegisterExportQuery;
  signal?: AbortSignal;
  onShardProgress?: (fetched: number, shardTotal: number) => void;
}): Promise<{ bytes: Uint8Array; dataRows: number; headerTotal: number }> {
  const params = buildRegisterExportParams(opts.query, 1, REGISTER_EXPORT_BATCH_CRM, false);
  params.set('export', 'csv');

  const res = await fetchWithRetry(`/api/report?${params.toString()}`, {
    credentials: 'include',
    signal: opts.signal,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Export failed (${res.status}). Retry in a moment.`);
  }

  const contentType = String(res.headers.get('content-type') ?? '');
  if (contentType.includes('application/json')) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || 'Server returned JSON instead of CSV');
  }

  const headerTotal = Number(res.headers.get('X-Register-Export-Total') ?? 0);
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Export response has no body');

  const chunks: Uint8Array[] = [];
  let newlines = 0;
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    chunks.push(value);
    received += value.length;
    newlines += countNewlinesInBytes(value);
    const fetched = csvDataRowsFromNewlineCount(newlines);
    opts.onShardProgress?.(
      headerTotal > 0 ? Math.min(headerTotal, fetched) : fetched,
      headerTotal > 0 ? headerTotal : Math.max(fetched, 1)
    );
  }

  const dataRows = csvDataRowsFromNewlineCount(newlines);
  assertRegisterCsvExportComplete(dataRows, headerTotal);

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, dataRows, headerTotal };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/** Stream register CSV from server into a prepared export blob. */
export async function prepareRegisterCsvFromServer(opts: {
  query: RegisterExportQuery;
  knownTotal?: number;
  signal?: AbortSignal;
  accessToken?: string | null;
  onProgress?: (progress: RegisterExportProgress) => void;
}): Promise<PreparedFileExport> {
  const fallbackTotal = Math.max(0, opts.knownTotal ?? 0);
  opts.onProgress?.({ fetched: 0, total: fallbackTotal });

  const useShards =
    fallbackTotal > REGISTER_CSV_SHARD_ROW_THRESHOLD &&
    Boolean(opts.query.startDate && opts.query.endDate);

  if (!useShards) {
    const single = await fetchOneRegisterCsvShard({
      query: opts.query,
      signal: opts.signal,
      onShardProgress: (fetched, shardTotal) => {
        opts.onProgress?.({
          fetched,
          total: fallbackTotal > 0 ? fallbackTotal : shardTotal,
        });
      },
    });
    const total = fallbackTotal > 0 ? fallbackTotal : single.headerTotal;
    assertRegisterCsvExportComplete(single.dataRows, total);
    opts.onProgress?.({ fetched: total > 0 ? total : single.dataRows, total: total || single.dataRows });
    const blob = new Blob([single.bytes as BlobPart], { type: 'text/csv;charset=utf-8;' });
    return blobToPreparedExport(
      blob,
      `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`
    );
  }

  // Keep each HTTP stream short — long single streams die around ~2 minutes on the edge.
  const start = parseYmd(opts.query.startDate);
  const end = parseYmd(opts.query.endDate);
  if (!start || !end) {
    throw new Error('Invalid export date range');
  }
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const rowsPerDay = fallbackTotal / days;
  const maxDaysPerShard = rowsPerDay > 8_000 ? 3 : rowsPerDay > 3_000 ? 7 : 14;
  const shards = splitRegisterExportDateShards(opts.query.startDate, opts.query.endDate, {
    maxDaysPerShard,
  });

  const shardFetched = new Array(shards.length).fill(0);
  const report = () => {
    const fetched = shardFetched.reduce((a, b) => a + b, 0);
    opts.onProgress?.({ fetched: Math.min(fallbackTotal, fetched), total: fallbackTotal });
  };

  const parts = await mapPool(shards, REGISTER_CSV_SHARD_CONCURRENCY, async (shard, index) => {
    const result = await fetchOneRegisterCsvShard({
      query: { ...opts.query, startDate: shard.startDate, endDate: shard.endDate },
      signal: opts.signal,
      onShardProgress: (fetched) => {
        shardFetched[index] = fetched;
        report();
      },
    });
    shardFetched[index] = result.dataRows;
    report();
    return result;
  });

  const totalRows = parts.reduce((sum, p) => sum + p.dataRows, 0);
  assertRegisterCsvExportComplete(totalRows, fallbackTotal);

  const merged: BlobPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i === 0) merged.push(part.bytes as BlobPart);
    else merged.push(stripCsvBomAndHeader(part.bytes) as BlobPart);
  }

  opts.onProgress?.({ fetched: fallbackTotal, total: fallbackTotal });
  const blob = new Blob(merged, { type: 'text/csv;charset=utf-8;' });
  return blobToPreparedExport(
    blob,
    `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`
  );
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
