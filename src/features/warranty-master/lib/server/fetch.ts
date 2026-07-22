import 'server-only';

import { postQuery } from '@/lib/db/proxy';
import { exportWarrantyMasterCsv } from '../export-csv';
import { summarizeWarrantyMasterRows } from '../filter';
import {
  normalizeAggregateRows,
  normalizeFgDetailRows,
  normalizeFgLineRows,
} from '../normalize';
import {
  buildWarrantyMasterAggregateSql,
  buildWarrantyMasterFgLinesSql,
  buildWarrantyMasterMetaSql,
  buildWarrantyMasterRowDetailSql,
} from '../sql';
import { sortWarrantyMasterAggregateRows } from '../sort';
import type {
  WarrantyMasterAggregateRow,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
  WarrantyMasterQueryParams,
  WarrantyMasterRowDetailParams,
} from '../types';

const QUERY_TIMEOUT_MS = 300_000;

async function fetchCrmSql(rawSql: string): Promise<Record<string, unknown>[]> {
  const res = await postQuery({ rawSql, timeoutMs: QUERY_TIMEOUT_MS });
  return (res.data || []) as Record<string, unknown>[];
}

export type WarrantyMasterMeta = {
  totalMachines: number;
};

/** Lightweight count for client cache invalidation (monthly refresh). */
export async function fetchWarrantyMasterMeta(): Promise<WarrantyMasterMeta> {
  const raw = await fetchCrmSql(buildWarrantyMasterMetaSql());
  const row = raw[0] ?? {};
  return {
    totalMachines: Number(row.totalMachines ?? 0),
  };
}

/** Primary load: full FG-line dataset for client-side filtering. */
export async function fetchWarrantyMasterFgLines(): Promise<WarrantyMasterFgLineRow[]> {
  const raw = await fetchCrmSql(buildWarrantyMasterFgLinesSql());
  return normalizeFgLineRows(raw);
}

/** Legacy: filtered aggregate rows (CSV export / mode=rows). */
export async function fetchWarrantyMasterRows(
  params: WarrantyMasterQueryParams
): Promise<WarrantyMasterAggregateRow[]> {
  const aggRaw = await fetchCrmSql(buildWarrantyMasterAggregateSql(params));
  return sortWarrantyMasterAggregateRows(normalizeAggregateRows(aggRaw));
}

/** Legacy: row expand via API (UI uses cached fg lines). */
export async function fetchWarrantyMasterRowDetail(
  detail: WarrantyMasterRowDetailParams
): Promise<WarrantyMasterFgDetailRow[]> {
  const raw = await fetchCrmSql(buildWarrantyMasterRowDetailSql(detail));
  return normalizeFgDetailRows(raw);
}

export async function runWarrantyMasterCsvExport(
  params: WarrantyMasterQueryParams
): Promise<string> {
  const rows = await fetchWarrantyMasterRows(params);
  return exportWarrantyMasterCsv(rows);
}

export { summarizeWarrantyMasterRows };
