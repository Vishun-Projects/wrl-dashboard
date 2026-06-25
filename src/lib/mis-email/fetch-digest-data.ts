import { defaultDateRange, toDateString } from '@/lib/report/filters';
import { querySummaryDashboard } from '@/lib/read-model/queries/summary';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import type { SummaryDashboard } from '@/lib/report/summary-derive';
import type { UserDigestScope } from '@/lib/mis-email/user-scope';

export type DigestDateRange = {
  startDate: string;
  endDate: string;
  label: string;
};

export function resolveDigestDateRange(): DigestDateRange {
  const range = defaultDateRange();
  return {
    startDate: toDateString(range.start),
    endDate: toDateString(range.end),
    label: range.label || 'This Month',
  };
}

export async function fetchDigestSummaryData(
  scope: UserDigestScope,
  dateRange: DigestDateRange = resolveDigestDateRange()
): Promise<SummaryDashboard> {
  if (!readSummaryFromPostgres()) {
    throw new Error(
      'MIS email digest requires READ_SUMMARY_FROM=postgres (or READ_CALLS_FROM=postgres)'
    );
  }

  return querySummaryDashboard({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    agingAsOf: dateRange.endDate,
    officeIds: [],
    callTypes: [],
    assignedOffices: scope.assignedOffices,
    isHod: scope.isHod,
  });
}
