import type { RegisterViewFilterParts } from '@/lib/report-filters';
import type { CorpusViewDateFilter } from '@/lib/report-corpus';
import { filterCorpusCallsByViewDate } from '@/lib/report-corpus';
import {
  classifyRegisterRowStatus,
  filterViewCalls,
  summarizeRegisterRows,
  type RegisterSummary,
  type RegisterSummaryBucket,
} from '@/lib/report-search';

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

export function isRegisterRowOpenBucket(bucket: RegisterSummaryBucket): boolean {
  return bucket === 'assigned' || bucket === 'openUnallocated';
}

export function isRegisterRowSolvedBucket(bucket: RegisterSummaryBucket): boolean {
  return bucket === 'closed' || bucket === 'techSolved';
}

export { classifyRegisterRowStatus };
