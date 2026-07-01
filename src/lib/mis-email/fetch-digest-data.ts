import { defaultDateRange, toDateString } from '@/lib/report/filters';
import { queryRegisterExportFromPostgres } from '@/lib/read-model/queries/register';
import { querySummaryDashboard } from '@/lib/read-model/queries/summary';
import { readCallsFromPostgres, readSummaryFromPostgres } from '@/lib/read-model/flags';
import type { SummaryDashboard } from '@/lib/report/summary-derive';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
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

export async function fetchDigestRegisterRows(
  recipient: DigestRecipient,
  scope: UserDigestScope,
  dateRange: DigestDateRange = resolveDigestDateRange()
): Promise<Record<string, unknown>[]> {
  if (!readCallsFromPostgres()) {
    throw new Error('MIS email detailed export requires READ_CALLS_FROM=postgres');
  }

  return queryRegisterExportFromPostgres({
    page: 1,
    limit: 1,
    search: '',
    officeId: 'All',
    callType: null,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    status: '',
    account: '',
    region: '',
    pincode: '',
    priority: 'all',
    portalFilter: 'All',
    state: '',
    city: '',
    branch: '',
    franchisee: '',
    technician: '',
    fetchTotals: false,
    fetchFilterOptions: false,
    assignedOffices: scope.assignedOffices,
    visibleStatuses: recipient.visible_statuses,
    isHod: scope.isHod,
  });
}
