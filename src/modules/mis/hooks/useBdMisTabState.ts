'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';
import {
  normalizeAgingAsOfDate,
  toDateString,
  joinFilterParam,
  resolveAppliedFilterParams,
} from '@/modules/mis/services/filters';
import type { BdMisGrandRow, BdMisRegionalRow, BdMisSourceFlags } from '@/modules/mis/services/bd-mis-summary';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/summary/derive';
import type { MisSourceSelection } from '@/modules/mis/client-import';
import { mergeFlagsFromSelection } from '@/modules/mis/components/SummaryMergedMetricCell';
import type { ClientMergeWithCrmPrefs } from '@/modules/mis/components/SummaryMergedMetricCell';
import { buildAccountDisplayRows } from '@/modules/mis/services/account-merge';
import { feedback } from '@/lib/ui/feedback';

interface UseBdMisTabStateProps {
  activeTab: string;
  dbInitialized: boolean;
  appliedRevision: number;
  sourceSelection: MisSourceSelection;
  sourceSelectionKey: string;
  enqueueExport: any;
  summaryData: any[];
  clientSummaryData: any[];
  accountsData: any[];
  clientAccountSummaryData: any[];
  mergeFlags: ReturnType<typeof mergeFlagsFromSelection>;
  clientMergeWithCrm: ClientMergeWithCrmPrefs;
  clientOnlyMode: boolean;
}

export function useBdMisTabState({
  activeTab,
  dbInitialized,
  appliedRevision,
  sourceSelection,
  sourceSelectionKey,
  enqueueExport,
  summaryData,
  clientSummaryData,
  accountsData,
  clientAccountSummaryData,
  mergeFlags,
  clientMergeWithCrm,
  clientOnlyMode,
}: UseBdMisTabStateProps) {
  const {
    selectedBranch,
    selectedFranchisee,
    dateRange,
    agingAsOf,
    offices,
    getAppliedFiltersSnapshot,
  } = useReportFilters();

  const [bdMisTabLoading, setBdMisTabLoading] = useState(false);
  const [bdMisRegionalRows, setBdMisRegionalRows] = useState<BdMisRegionalRow[]>([]);
  const [bdMisGrand, setBdMisGrand] = useState<BdMisGrandRow | null>(null);
  const [bdMisExportData, setBdMisExportData] = useState<{
    regionalRows: BdMisRegionalRow[];
    grand: BdMisGrandRow;
    crmBranchSummary: BranchSummaryRow[];
    crmAccountSummary: AccountSummaryRow[];
    clientAccountSummary: AccountSummaryRow[];
    sources: BdMisSourceFlags;
  } | null>(null);

  const fetchBdMisSummaryPayload = useCallback(async () => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    const { startDateStr, endDateStr, officeIdsParam: summaryOfficeIds, viewCallTypesParam: callTypesParam, agingStr } =
      resolveAppliedFilterParams(applied, offices);
    const clientSources = sourceSelection.clientSourceCodes.length
      ? sourceSelection.clientSourceCodes.join(',')
      : 'coke,cadbury';

    const res = await axios.get('/api/report/bd-mis-summary', {
      withCredentials: true,
      params: {
        officeId: summaryOfficeIds,
        callType: callTypesParam,
        startDate: startDateStr,
        endDate: endDateStr,
        agingAsOf: agingStr,
        includeCrm: sourceSelection.crm ? 'true' : 'false',
        clientSources,
      },
    });
    return res.data;
  }, [getAppliedFiltersSnapshot, offices, sourceSelection]);

  const loadBdMisSummary = useCallback(async () => {
    const data = await fetchBdMisSummaryPayload();
    if (!data) return;

    const regionalRows = data.regionalRows ?? [];
    const grand = data.grand;
    setBdMisRegionalRows(regionalRows);
    setBdMisGrand(grand ?? null);
    if (grand && regionalRows.length) {
      setBdMisExportData({
        regionalRows,
        grand,
        crmBranchSummary: data.crmBranchSummary ?? [],
        crmAccountSummary: data.crmAccountSummary ?? [],
        clientAccountSummary: data.clientAccountSummary ?? [],
        sources: data.sources ?? {
          crm: sourceSelection.crm,
          cadbury: sourceSelection.clientSourceCodes.includes('cadbury'),
          coke: sourceSelection.clientSourceCodes.includes('coke'),
        },
      });
    } else {
      setBdMisExportData(null);
    }
  }, [fetchBdMisSummaryPayload, sourceSelection]);

  const buildBdMisExportFilterMeta = useCallback(() => {
    const applied = getAppliedFiltersSnapshot();
    return {
      startDate: toDateString(applied?.dateRange.start ?? dateRange.start),
      endDate: toDateString(applied?.dateRange.end ?? dateRange.end),
      agingAsOf: normalizeAgingAsOfDate(applied?.agingAsOf ?? agingAsOf),
      callTypes:
        applied?.selectedCallTypes?.map((t) => String(t).toUpperCase()).join(', ') || 'BREAKDOWN',
      branches: joinFilterParam(applied?.selectedBranch ?? selectedBranch) || 'All Branches',
      franchisees:
        joinFilterParam(applied?.selectedFranchisee ?? selectedFranchisee) || 'All Franchisees',
      sources:
        bdMisExportData?.sources ??
        ({
          crm: sourceSelection.crm,
          cadbury: sourceSelection.clientSourceCodes.includes('cadbury'),
          coke: sourceSelection.clientSourceCodes.includes('coke'),
        } satisfies BdMisSourceFlags),
    };
  }, [
    getAppliedFiltersSnapshot,
    dateRange.start,
    dateRange.end,
    agingAsOf,
    selectedBranch,
    selectedFranchisee,
    bdMisExportData?.sources,
    sourceSelection,
  ]);

  const executeBdMisTraceExport = useCallback(async () => {
    const traceT0 = performance.now();
    console.info('[bd-mis-trace-export] start');
    const applied = getAppliedFiltersSnapshot();
    if (!applied) {
      throw new Error('Wait for the dashboard to load before exporting.');
    }
    const traceAlign = activeTab === 'summary' ? 'summary' : 'bd_mis';
    const { startDateStr, endDateStr, officeIdsParam: summaryOfficeIds, viewCallTypesParam: callTypesParam, agingStr } =
      resolveAppliedFilterParams(applied, offices);
    const clientSources = sourceSelection.clientSourceCodes.length
      ? sourceSelection.clientSourceCodes.join(',')
      : 'coke,cadbury';

    const apiT0 = performance.now();
    const res = await axios.get('/api/report/bd-mis-summary', {
      withCredentials: true,
      params: {
        officeId: summaryOfficeIds,
        callType: callTypesParam,
        startDate: startDateStr,
        endDate: endDateStr,
        agingAsOf: agingStr,
        includeCrm: sourceSelection.crm ? 'true' : 'false',
        clientSources,
        includeTrace: 'true',
        traceAlign,
      },
    });
    console.info('[bd-mis-trace-export] api-ok', {
      elapsed_ms: Math.round(performance.now() - apiT0),
      status: res.status,
    });

    const data = res.data;
    let regionalRows = data.regionalRows ?? [];
    let grand = data.grand;
    let crmBranchSummary = data.crmBranchSummary ?? [];
    let crmAccountSummary = data.crmAccountSummary ?? [];
    let clientAccountSummary = data.clientAccountSummary ?? [];
    const traceRows = data.traceRows ?? [];
    let summaryDashboard:
      | {
          summaryData: BranchSummaryRow[];
          uiAlign: import('@/modules/mis/services/summary-trace-export').SummaryDashboardExportAlign;
        }
      | undefined;

    if (traceAlign === 'summary') {
      const {
        buildUiRegionalPerformanceRows,
        sumUiRegionalRows,
        toBdMisGrandRow,
        toBdMisRegionalRow,
        buildSummaryDashboardExportAlign,
      } = await import('@/modules/mis/services/summary-trace-export');
      const uiRegional = buildUiRegionalPerformanceRows(
        summaryData,
        clientSummaryData,
        mergeFlags
      );
      if (!uiRegional.length) {
        throw new Error('No data to export. Wait for the dashboard to load.');
      }
      const uiGrand = sumUiRegionalRows(uiRegional);
      regionalRows = uiRegional.map(toBdMisRegionalRow);
      grand = toBdMisGrandRow(uiGrand);
      crmBranchSummary = summaryData;
      crmAccountSummary = accountsData;
      clientAccountSummary = clientAccountSummaryData ?? [];
      summaryDashboard = {
        summaryData,
        uiAlign: buildSummaryDashboardExportAlign({
          summaryData,
          clientSummaryData,
          clientAccountSummaryData: clientAccountSummary,
          mergedAccountRows: buildAccountDisplayRows(
            accountsData,
            clientAccountSummary,
            mergeFlags
          ),
          mergeFlags,
          clientMergeWithCrm,
          clientOnlyMode,
        }),
      };
    }

    console.info('[bd-mis-trace-export] payload', {
      trace_align: traceAlign,
      regional_rows: regionalRows.length,
      trace_rows: traceRows.length,
      has_grand: Boolean(grand),
    });

    if (!regionalRows.length || !grand) {
      throw new Error('No data to export. Wait for the dashboard to load.');
    }

    const { buildBdMisTraceableWorkbook, bdMisTraceableFilename, summaryTraceFilename } = await import(
      '@/modules/mis/services/bd-mis-excel-export'
    );
    const buildT0 = performance.now();
    const workbook = await buildBdMisTraceableWorkbook({
      regionalRows,
      grand,
      crmBranchSummary,
      crmAccountSummary,
      clientAccountSummary,
      sources: data.sources ?? {
        crm: sourceSelection.crm,
        cadbury: sourceSelection.clientSourceCodes.includes('cadbury'),
        coke: sourceSelection.clientSourceCodes.includes('coke'),
      },
      traceRows,
      traceAlign,
      summaryDashboard,
      filterMeta: buildBdMisExportFilterMeta(),
    });
    console.info('[bd-mis-trace-export] workbook-built', {
      elapsed_ms: Math.round(performance.now() - buildT0),
      sheets: workbook.worksheets.length,
    });
    const filename =
      traceAlign === 'summary' ? summaryTraceFilename() : bdMisTraceableFilename();
    const dlT0 = performance.now();
    console.info('[bd-mis-trace-export] download-trigger', { filename });
    const { workbookToPreparedExport } = await import('@/modules/mis/services/summary-excel-export');
    const prepared = await workbookToPreparedExport(workbook, filename);
    console.info('[bd-mis-trace-export] prepare-finished', {
      elapsed_ms: Math.round(performance.now() - dlT0),
    });
    console.info('[bd-mis-trace-export] done', {
      total_elapsed_ms: Math.round(performance.now() - traceT0),
    });
    return prepared;
  }, [
    activeTab,
    getAppliedFiltersSnapshot,
    offices,
    sourceSelection,
    buildBdMisExportFilterMeta,
    summaryData,
    clientSummaryData,
    mergeFlags,
    accountsData,
    clientAccountSummaryData,
    clientMergeWithCrm,
    clientOnlyMode,
  ]);

  const handleBdMisTraceExport = useCallback(() => {
    const sourceTab = activeTab;
    enqueueExport(
      'Summary + Row Trace Excel',
      async (_ctx: any) => {
        try {
          return await executeBdMisTraceExport();
        } catch (err) {
          const message =
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Export failed';
          feedback.actionFailed(`Failed to export trace workbook: ${message}`);
          throw err instanceof Error ? err : new Error(message);
        }
      },
      { sourceTab, kind: 'trace' }
    );
  }, [activeTab, enqueueExport, executeBdMisTraceExport]);

  useEffect(() => {
    if (!dbInitialized) return;
    if (activeTab !== 'bd_mis_summary') return;

    setBdMisTabLoading(true);
    void loadBdMisSummary()
      .catch((err) => {
        console.warn('BD MIS summary fetch failed:', err);
      })
      .finally(() => {
        setBdMisTabLoading(false);
      });
  }, [dbInitialized, activeTab, appliedRevision, loadBdMisSummary, sourceSelectionKey]);

  return {
    bdMisTabLoading,
    setBdMisTabLoading,
    bdMisRegionalRows,
    setBdMisRegionalRows,
    bdMisGrand,
    setBdMisGrand,
    bdMisExportData,
    setBdMisExportData,
    loadBdMisSummary,
    buildBdMisExportFilterMeta,
    executeBdMisTraceExport,
    handleBdMisTraceExport,
  };
}
