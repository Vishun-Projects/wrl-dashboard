/** Server-only: unified align needs Postgres client branch summary. */
import { queryAllClientBranchSummary } from '@/modules/mis/client-import/services/aggregate';
import { buildAccountDisplayRows } from '@/modules/mis/services/account-merge';
import { buildSummaryDashboardExportAlign } from '@/modules/mis/services/summary-trace-export';
import type { SummaryDashboardExportAlign } from '@/modules/mis/services/summary-trace-export';
import type { AccountSummaryRow, SummaryDashboard } from '@/lib/summary/derive';
import {
  MIS_UNIFIED_CLIENT_MERGE,
  MIS_UNIFIED_MERGE_FLAGS,
} from '@/modules/mis/services/mis-unified-metrics';

export async function buildMisUnifiedReportAlign(
  summary: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[],
  dateRange: { startDate: string; endDate: string }
): Promise<SummaryDashboardExportAlign> {
  const clientBranchSummary = await queryAllClientBranchSummary({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    agingAsOf: dateRange.endDate,
  });
  const mergedAccountRows = buildAccountDisplayRows(
    summary.accountSummary as Array<Record<string, unknown>>,
    clientAccountSummary as Array<Record<string, unknown>>,
    MIS_UNIFIED_MERGE_FLAGS
  );
  return buildSummaryDashboardExportAlign({
    summaryData: summary.branchSummary,
    clientSummaryData: clientBranchSummary,
    clientAccountSummaryData: clientAccountSummary,
    mergedAccountRows,
    mergeFlags: MIS_UNIFIED_MERGE_FLAGS,
    clientMergeWithCrm: MIS_UNIFIED_CLIENT_MERGE,
    clientOnlyMode: false,
  });
}
