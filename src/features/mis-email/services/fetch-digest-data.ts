import { resolveDigestDateRangeForPreferences } from '@/features/mis-email/services/preferences';
import {
  queryDigestRegisterExportFromPostgres,
} from '@/lib/read-model/queries/register';
import { querySummaryDashboard } from '@/lib/read-model/queries/summary';
import { readCallsFromPostgres, readSummaryFromPostgres } from '@/lib/read-model/flags';
import type { SummaryDashboard } from '@/features/report';
import type { DigestRecipient } from '@/features/mis-email/services/recipients';
import type { UserDigestScope } from '@/features/mis-email/services/user-scope';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/features/report';
import { getMisEmailOrgSettings } from '@/features/mis-email/services/org-settings';

export type DigestDateRange = {
  startDate: string;
  endDate: string;
  label: string;
};

/** Default digest range: month through yesterday (IST). */
export function resolveDigestDateRange(): DigestDateRange {
  return resolveDigestDateRangeForPreferences({ dateRange: 'month_to_date' });
}

async function resolveDigestCallType(): Promise<string> {
  try {
    const org = await getMisEmailOrgSettings();
    return org.digestCallType || SUMMARY_DEFAULT_CALL_TYPE;
  } catch {
    return SUMMARY_DEFAULT_CALL_TYPE;
  }
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

  const callType = await resolveDigestCallType();
  const started = Date.now();
  const data = await querySummaryDashboard({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    agingAsOf: dateRange.endDate,
    officeIds: [],
    callTypes: [callType],
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

  const callType = await resolveDigestCallType();
  const started = Date.now();
  console.log(
    `[mis-email/timing] queryDigestRegisterExport ${dateRange.startDate}→${dateRange.endDate} · direct Postgres`
  );
  const rows = await queryDigestRegisterExportFromPostgres({
    page: 1,
    limit: 1,
    search: '',
    officeId: 'All',
    callType,
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
