import { formatExportDate } from '@/lib/utils/export-dates';
import { escapeCsvCell, excelTextFormula } from '@/lib/utils/csv';
import type { RejectedCallRow } from '../types';

export const REJECTED_CALLS_CSV_HEADERS = [
  'Call No',
  'Call Date',
  'Serial No',
  'Call Type',
  'Activity Done',
  'Solve Date',
  'Rejected By',
  'Rejection At',
  'Rejection Reason',
  'Rejected By Name',
  'Branch',
  'Franchisee',
] as const;

/** Cap CRM export in one OFFSET/FETCH (viewstate / timeout). */
export const REJECTED_CALLS_CSV_CAP = 10_000;

export function rejectedCallToCsvLine(row: RejectedCallRow): string {
  return [
    excelTextFormula(row.callNo),
    formatExportDate(row.callDate),
    excelTextFormula(row.serialNo ?? ''),
    row.callType ?? '',
    row.activityDone ?? '',
    formatExportDate(row.solveDate),
    row.rejectedBySource,
    formatExportDate(row.rejectionAt),
    row.rejectionReason ?? '',
    row.rejectedByName ?? '',
    row.branchName ?? '',
    row.franchiseeName ?? '',
  ]
    .map(escapeCsvCell)
    .join(',');
}

export function buildRejectedCallsCsv(rows: RejectedCallRow[]): string {
  return [REJECTED_CALLS_CSV_HEADERS.join(','), ...rows.map(rejectedCallToCsvLine)].join('\n');
}

export function buildRejectedCallsCsvResponse(rows: RejectedCallRow[], endDate: string): Response {
  return new Response(`\uFEFF${buildRejectedCallsCsv(rows)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rejected-calls-${endDate}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
