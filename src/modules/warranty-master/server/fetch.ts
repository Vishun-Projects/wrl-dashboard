import 'server-only';

import { exportWarrantyMasterDetailedCsv } from '../services/export-csv';
import { summarizeWarrantyMasterRows } from '../services/filter';
import {
  getWarrantyMasterDbStats,
  queryWarrantyMasterFgLinesFromDb,
  queryWarrantyMasterSerialsFromDb,
  countWarrantyMasterSerialsFromDb,
  queryWarrantyMasterExportRowsFromDb,
} from './db';
import type {
  WarrantyMasterAggregateRow,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
  WarrantyMasterQueryParams,
  WarrantyMasterRowDetailParams,
  WarrantyMasterSerialRow,
} from '../services/types';

export type WarrantyMasterMeta = {
  totalMachines: number;
  dbCount?: number;
  lastSyncedAt?: string | null;
};

/** Count for client cache invalidation and UI machine totals directly from local Postgres. */
export async function fetchWarrantyMasterMeta(): Promise<WarrantyMasterMeta> {
  const stats = await getWarrantyMasterDbStats();
  return {
    totalMachines: stats.totalCount,
    dbCount: stats.totalCount,
    lastSyncedAt: stats.lastSyncedAt,
  };
}

/** Primary load: full FG-line dataset for client-side filtering directly from local Postgres. */
export async function fetchWarrantyMasterFgLines(): Promise<WarrantyMasterFgLineRow[]> {
  return queryWarrantyMasterFgLinesFromDb();
}

/** Fetch machine serials matching search query or row/FG breakdown directly from local Postgres. */
export async function fetchWarrantyMasterSerials(
  params: WarrantyMasterQueryParams & {
    customerKey?: string;
    customerSubgroup?: string;
    groupKey?: string;
    rowWarrantyMonths?: number;
    limit?: number;
    offset?: number;
  }
): Promise<WarrantyMasterSerialRow[]> {
  return queryWarrantyMasterSerialsFromDb(params);
}

export async function countWarrantyMasterSerials(
  params: WarrantyMasterQueryParams & {
    customerKey?: string;
    customerSubgroup?: string;
    groupKey?: string;
    rowWarrantyMonths?: number;
  }
): Promise<number> {
  return countWarrantyMasterSerialsFromDb(params);
}

/** Filtered aggregate rows directly from Postgres. */
export async function fetchWarrantyMasterRows(
  _params: WarrantyMasterQueryParams
): Promise<WarrantyMasterAggregateRow[]> {
  const lines = await queryWarrantyMasterFgLinesFromDb();
  return lines.map((l) => ({
    customerName: l.customerName,
    customerSubgroup: l.customerSubgroup,
    groupName: l.groupName,
    customerKey: l.customerKey,
    groupKey: l.groupKey,
    warrantyMonths: l.warrantyMonths,
    machineCount: l.machineCount,
  }));
}

/** Row expand via local Postgres. */
export async function fetchWarrantyMasterRowDetail(
  detail: WarrantyMasterRowDetailParams
): Promise<WarrantyMasterFgDetailRow[]> {
  const serials = await queryWarrantyMasterSerialsFromDb({
    customerKey: detail.customerKey ?? detail.customerName,
    groupKey: detail.groupKey ?? detail.groupName,
    rowWarrantyMonths: Number(detail.rowWarrantyMonths),
    limit: 1000,
  });
  const modelCounts = new Map<string, number>();
  for (const s of serials) {
    modelCounts.set(s.fgModel, (modelCounts.get(s.fgModel) ?? 0) + 1);
  }
  return Array.from(modelCounts.entries()).map(([fgModel, machineCount]) => ({
    fgModel,
    machineCount,
  }));
}

export async function runWarrantyMasterCsvExport(
  params: WarrantyMasterQueryParams
): Promise<string> {
  const rows = await queryWarrantyMasterExportRowsFromDb(params);
  return exportWarrantyMasterDetailedCsv(rows);
}

export { summarizeWarrantyMasterRows };
