import { defaultDateRange, toDateString, SUMMARY_DEFAULT_CALL_TYPE } from '@/lib/report/filters';
import {
  queryDigestRegisterExportFromPostgres,
} from '@/lib/read-model/queries/register';
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

  const started = Date.now();
  const data = await querySummaryDashboard({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    agingAsOf: dateRange.endDate,
    officeIds: [],
    callTypes: [SUMMARY_DEFAULT_CALL_TYPE],
    assignedOffices: scope.assignedOffices,
    isHod: scope.isHod,
  });
  console.log(
    `[mis-email/timing] querySummaryDashboard ${dateRange.startDate}→${dateRange.endDate}: ${Date.now() - started}ms`
  );
  return data;
}

export async function fetchDigestRegisterRows(
  recipient: DigestRecipient,
  scope: UserDigestScope,
  dateRange: DigestDateRange = resolveDigestDateRange()
): Promise<Record<string, unknown>[]> {
  if (!readCallsFromPostgres()) {
    throw new Error('MIS email detailed export requires READ_CALLS_FROM=postgres');
  }

  const started = Date.now();
  console.log(
    `[mis-email/timing] queryDigestRegisterExport ${dateRange.startDate}→${dateRange.endDate} · direct Postgres`
  );
  const rows = await queryDigestRegisterExportFromPostgres({
    page: 1,
    limit: 1,
    search: '',
    officeId: 'All',
    callType: SUMMARY_DEFAULT_CALL_TYPE,
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
  console.log(
    `[mis-email/timing] queryDigestRegisterExport ${dateRange.startDate}→${dateRange.endDate}: ${Date.now() - started}ms · rows=${rows.length}`
  );
  return rows;
}
