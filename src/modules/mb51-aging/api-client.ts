import { fetchWithRetry } from '@/lib/net/fetch-with-retry';
import type {
  Mb51AgingImportMeta,
  Mb51AgingMovement,
  Mb51AgingReportParams,
  Mb51AgingSummary,
  Mb51AgingThinRow,
} from '@/modules/mb51-aging/types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url, {
    credentials: 'include',
    retries: 3,
    retryDelayMs: 800,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    retries: 2,
    retryDelayMs: 1000,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function withImport(sp: URLSearchParams, importId?: string | null) {
  if (importId) sp.set('importId', importId);
}

export async function fetchMb51Meta(importId?: string | null): Promise<{
  latestImport: Mb51AgingImportMeta | null;
  imports: Mb51AgingImportMeta[];
}> {
  const sp = new URLSearchParams();
  withImport(sp, importId);
  const q = sp.toString();
  return getJson(`/api/report/mb51-aging/meta${q ? `?${q}` : ''}`);
}

export async function fetchMb51Summary(
  paramHash = 'default',
  importId?: string | null
): Promise<{
  latestImport: Mb51AgingImportMeta | null;
  summary: Mb51AgingSummary | null;
  params: Mb51AgingReportParams | null;
  imports: Mb51AgingImportMeta[];
}> {
  const sp = new URLSearchParams();
  sp.set('paramHash', paramHash);
  withImport(sp, importId);
  return getJson(`/api/report/mb51-aging/summary?${sp}`);
}

export async function fetchMb51AggPage(opts: {
  paramHash?: string;
  importId?: string | null;
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: string;
  sortDir?: number;
  vendors?: string[];
  groups?: string[];
  materials?: string[];
  excludedMaterials?: string[];
  withSummary?: boolean;
}): Promise<{
  rows: Mb51AgingThinRow[];
  total: number;
  page: number;
  pageSize: number;
  paramHash: string;
  summary?: Mb51AgingSummary;
}> {
  const sp = new URLSearchParams();
  sp.set('paramHash', opts.paramHash || 'default');
  sp.set('page', String(opts.page ?? 1));
  sp.set('pageSize', String(opts.pageSize ?? 100));
  withImport(sp, opts.importId);
  if (opts.q) sp.set('q', opts.q);
  if (opts.sort) sp.set('sort', opts.sort);
  if (opts.sortDir != null) sp.set('sortDir', String(opts.sortDir));
  if (opts.vendors?.length) sp.set('vendors', opts.vendors.join(','));
  if (opts.groups?.length) sp.set('groups', opts.groups.join(','));
  if (opts.materials?.length) sp.set('materials', opts.materials.join(','));
  if (opts.excludedMaterials?.length) {
    sp.set('excludedMaterials', opts.excludedMaterials.join(','));
  }
  if (opts.withSummary) sp.set('withSummary', '1');
  return getJson(`/api/report/mb51-aging/agg?${sp}`);
}

export async function postMb51Report(
  params: Mb51AgingReportParams,
  importId?: string | null
): Promise<{
  summary: Mb51AgingSummary;
  paramHash: string;
}> {
  return postJson('/api/report/mb51-aging/report', { ...params, importId: importId || undefined });
}

export async function postMb51Detail(opts: {
  paramHash?: string;
  importId?: string | null;
  groupKey: string;
  bucketIdx: number;
}): Promise<{
  lines: [Mb51AgingMovement, number, number][];
  net?: {
    pos: number;
    neg: number;
    net: number;
    n: number;
    r: Mb51AgingMovement;
  }[];
}> {
  return postJson('/api/report/mb51-aging/detail', opts);
}

export async function fetchMb51Facets(
  q = '',
  importId?: string | null,
  opts?: {
    fields?: Array<'plants' | 'vendors' | 'groups' | 'materials' | 'movements'>;
    limit?: number;
  }
): Promise<{
  plants: { id: string; text: string }[];
  vendors: { id: string; text: string }[];
  groups: { id: string; text: string }[];
  materials: { id: string; text: string }[];
  movements: { id: string; text: string }[];
  totals: {
    vendors: number;
    materials: number;
    groups: number;
    plants: number;
    movements: number;
  };
}> {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  sp.set('limit', String(opts?.limit ?? (q ? 200 : 2000)));
  if (opts?.fields?.length) sp.set('fields', opts.fields.join(','));
  withImport(sp, importId);
  return getJson(`/api/report/mb51-aging/facets?${sp}`);
}

export async function fetchMb51MovementsPage(opts: {
  importId?: string | null;
  afterSeq?: number;
  offset?: number;
  limit?: number;
  dateFrom?: number | null;
  dateTo?: number | null;
  plants?: string[];
  vendors?: string[];
  groups?: string[];
  materials?: string[];
  movements?: string[];
  q?: string;
}): Promise<{
  rows: Mb51AgingMovement[];
  nextAfter: number;
  done: boolean;
  kpis: {
    filteredCount: number;
    netQty: number;
    receiptQty: number;
    issueQty: number;
    uniqueMaterials: number;
    uniqueVendors: number;
    uniquePlants: number;
  };
  totalCount: number;
}> {
  const sp = new URLSearchParams();
  withImport(sp, opts.importId);
  if (opts.offset != null) sp.set('offset', String(opts.offset));
  else sp.set('afterSeq', String(opts.afterSeq ?? -1));
  sp.set('limit', String(opts.limit ?? 100));
  if (opts.dateFrom != null) sp.set('dateFrom', String(opts.dateFrom));
  if (opts.dateTo != null) sp.set('dateTo', String(opts.dateTo));
  if (opts.plants?.length) sp.set('plants', opts.plants.join(','));
  if (opts.vendors?.length) sp.set('vendors', opts.vendors.join(','));
  if (opts.groups?.length) sp.set('groups', opts.groups.join(','));
  if (opts.materials?.length) sp.set('materials', opts.materials.join(','));
  if (opts.movements?.length) sp.set('movements', opts.movements.join(','));
  if (opts.q) sp.set('q', opts.q);
  return getJson(`/api/report/mb51-aging/movements?${sp}`);
}
