import type { RegisterViewFilterParts } from '@/features/report/services/filters';
import type { CorpusViewDateFilter } from '@/features/report/services/corpus';
import { filterCorpusCallsByViewDate, registerRowDateValue } from '@/features/report/services/corpus';
import type { RegisterDateFilterColumn } from '@/lib/trhcalls/query';
import {
  classifyRegisterRowStatus,
  filterViewCalls,
  summarizeRegisterRows,
  type RegisterSummary,
  type RegisterSummaryBucket,
} from '@/features/report/services/search';

export function deriveRegisterView(
  calls: Record<string, unknown>[],
  filterParts: RegisterViewFilterParts,
  viewDateFilter: CorpusViewDateFilter
): { filteredCalls: Record<string, unknown>[]; summary: RegisterSummary } {
  const dateFiltered = filterCorpusCallsByViewDate(calls, viewDateFilter);
  const filteredCalls = filterViewCalls(dateFiltered, filterParts);
  const summary = summarizeRegisterRows(filteredCalls);
  return { filteredCalls, summary };
}

function sortRegisterCalls(
  rows: Record<string, unknown>[],
  dateFilterColumn: RegisterDateFilterColumn
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const dateA = new Date(String(registerRowDateValue(a, dateFilterColumn) ?? 0)).getTime();
    const dateB = new Date(String(registerRowDateValue(b, dateFilterColumn) ?? 0)).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return Number(b.ncode ?? b.id ?? 0) - Number(a.ncode ?? a.id ?? 0);
  });
}

/** Paginate in-memory register rows (Postgres bulk cache or CRM corpus). */
export function deriveRegisterPageFromCalls(
  calls: Record<string, unknown>[],
  filterParts: RegisterViewFilterParts,
  page: number,
  pageLimit: number,
  viewDateFilter: CorpusViewDateFilter
): { rows: Record<string, unknown>[]; total: number } {
  const { filteredCalls } = deriveRegisterView(calls, filterParts, viewDateFilter);
  const sorted = sortRegisterCalls(filteredCalls, viewDateFilter.dateFilterColumn);
  const start = (page - 1) * pageLimit;
  return {
    rows: sorted.slice(start, start + pageLimit),
    total: sorted.length,
  };
}

export function isRegisterRowOpenBucket(bucket: RegisterSummaryBucket): boolean {
  return bucket === 'assigned' || bucket === 'openUnallocated';
}

export function isRegisterRowSolvedBucket(bucket: RegisterSummaryBucket): boolean {
  return bucket === 'closed' || bucket === 'techSolved';
}

export { classifyRegisterRowStatus };
