import { DEFAULT_MIS_SOURCE_SELECTION } from '@/lib/mis-client-import/source-selection';
import {
  queryAllClientBranchSummary,
  queryClientCallTraceRowsFiltered,
} from '@/lib/mis-client-import/aggregate';
import type { StatusBucket } from '@/lib/mis-client-import/types';
import { queryBdMisCrmCallTraceRows } from '@/lib/read-model/queries/bd-mis-summary';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';
import type { UserDigestScope } from '@/lib/mis-email/user-scope';
import type { BdMisTraceableExportPayload } from '@/lib/report/bd-mis-excel-export';
import { bdMisSourcesFromSelection } from '@/lib/report/bd-mis-summary';
import { buildBdMisTraceRows } from '@/lib/report/bd-mis-trace';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/lib/report/filters';
import {
  buildUiRegionalPerformanceRows,
  sumUiRegionalRows,
  toBdMisGrandRow,
  toBdMisRegionalRow,
} from '@/lib/report/summary-trace-export';
import type { AccountSummaryRow, SummaryDashboard } from '@/lib/report/summary-derive';

const DIGEST_MERGE_FLAGS = { crm: true, client: true };

export async function buildDigestTraceableExportPayload(
  scope: UserDigestScope,
  dateRange: DigestDateRange,
  summaryData: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[]
): Promise<BdMisTraceableExportPayload> {
  const sourceCodes = DEFAULT_MIS_SOURCE_SELECTION.clientSourceCodes;
  const sources = bdMisSourcesFromSelection(true, sourceCodes);

  const started = Date.now();
  const [clientBranchSummary, crmCallRows, clientCallRows] = await Promise.all([
    queryAllClientBranchSummary({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      sourceCodes,
    }),
    queryBdMisCrmCallTraceRows({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      officeIds: [],
      callTypes: [SUMMARY_DEFAULT_CALL_TYPE],
      assignedOffices: scope.assignedOffices,
      isHod: scope.isHod,
    }),
    queryClientCallTraceRowsFiltered({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      sourceCodes,
    }),
  ]);

  console.log(
    `[mis-email/timing] trace export data ${dateRange.startDate}→${dateRange.endDate}: ${Date.now() - started}ms · crmCalls=${crmCallRows.length} clientCalls=${clientCallRows.length}`
  );

  const traceRows = buildBdMisTraceRows({
    crmRows: crmCallRows.map((row) => ({
      ...row,
      status_bucket: row.status_bucket as StatusBucket,
    })),
    clientRows: clientCallRows,
    sources,
    agingDate: dateRange.endDate,
  });

  const uiRegional = buildUiRegionalPerformanceRows(
    summaryData.branchSummary,
    clientBranchSummary,
    DIGEST_MERGE_FLAGS
  );
  if (!uiRegional.length) {
    throw new Error('No summary data available for traceable export');
  }
  const uiGrand = sumUiRegionalRows(uiRegional);

  return {
    regionalRows: uiRegional.map(toBdMisRegionalRow),
    grand: toBdMisGrandRow(uiGrand),
    crmBranchSummary: summaryData.branchSummary,
    crmAccountSummary: summaryData.accountSummary,
    clientAccountSummary,
    sources,
    traceRows,
    traceAlign: 'summary',
    filterMeta: {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      callTypes: SUMMARY_DEFAULT_CALL_TYPE,
      branches: scope.scopeLabel,
      franchisees: 'All Franchisees',
      sources,
    },
  };
}
