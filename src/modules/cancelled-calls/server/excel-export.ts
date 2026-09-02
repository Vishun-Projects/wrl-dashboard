import type ExcelJS from 'exceljs';
import type { CancelledCallRow } from '@/modules/cancelled-calls/types';
import {
  CANCELLED_CALLS_CSV_HEADERS,
  cancelledCallRowToExportValues,
} from '@/modules/cancelled-calls/server/csv';
import { applySummaryHeaderStyle } from '@/modules/mis';

export type CancelledCallsBranchOverview = {
  branch: string;
  count: number;
};

export function cancelledCallsOverview(
  byBranch: Map<string, CancelledCallRow[]>
): CancelledCallsBranchOverview[] {
  return [...byBranch.entries()]
    .filter(([, rows]) => rows.length > 0)
    .map(([branch, rows]) => ({ branch, count: rows.length }))
    .sort((a, b) => b.count - a.count || a.branch.localeCompare(b.branch));
}

export async function buildCancelledCallsWorkbook(
  byBranch: Map<string, CancelledCallRow[]>
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const overview = cancelledCallsOverview(byBranch);
  const allRows = overview.flatMap(({ branch }) => byBranch.get(branch) ?? []);

  const overviewSheet = workbook.addWorksheet('Overview', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  overviewSheet.columns = [
    { key: 'branch', width: 28 },
    { key: 'count', width: 10 },
  ];
  const overviewHeader = overviewSheet.addRow(['Branch', 'Count']);
  applySummaryHeaderStyle(overviewHeader);
  if (overview.length) {
    overviewSheet.addRows(overview.map((row) => [row.branch, row.count]));
    const total = overview.reduce((sum, row) => sum + row.count, 0);
    overviewSheet.addRow(['Total', total]);
  }

  const detailSheet = workbook.addWorksheet('All calls', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  detailSheet.columns = CANCELLED_CALLS_CSV_HEADERS.map((header) => ({
    key: header,
    width: header.length < 8 ? 12 : Math.min(24, header.length + 4),
  }));
  const detailHeader = detailSheet.addRow([...CANCELLED_CALLS_CSV_HEADERS]);
  applySummaryHeaderStyle(detailHeader);
  if (allRows.length) {
    detailSheet.addRows(allRows.map((row) => cancelledCallRowToExportValues(row)));
  }

  return workbook;
}

export function cancelledCallsWorkbookFilename(digestDate: string): string {
  return `WRL_Cancelled_Calls_${digestDate}.xlsx`;
}
