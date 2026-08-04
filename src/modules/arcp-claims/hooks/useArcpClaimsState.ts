'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createChunkedFetchAuth } from '@/lib/supabase/chunked-fetch';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';
import { usePageAlert } from '@/hooks/usePageAlert';
import {
  ARCP_DEFAULT_DATE_FILTER_COLUMN,
  resolveArcpClientLoadPlan,
  deriveArcpGrandTotalsFromAggregates,
  ARCP_MERGE_ACROSS_CHUNKS,
  mergeArcpAggregateRows,
  type ArcpClaimsAggregateRow,
  type ArcpDateFilterColumn,
} from '@/sql/arcp-claims/query';
import { formatReportScopeSubtitle, isWideOrganizationScope, joinFilterParam, toDateString } from '@/modules/mis';
import { type ArcpAppliedFiltersSnapshot as AppliedArcpFiltersSnapshot, appliedArcpFiltersKey, arcpQueryOptsFromFilters, filtersFromLoadJobSnapshot } from '@/modules/arcp-claims/services/applied-filters';
import { enrichArcpAggregateLabelsClient, getBranchLabel, getFranchiseeLabel, getCallTypeLabel, getDateBasisLabel } from '@/modules/arcp-claims/services/labels';
import { applyArcpTallyDetailLevel, buildArcpClaimsMonthlyBreakdown, buildArcpClaimsTableModel, countArcpCategorySections, type ArcpTallyDetailLevel, type ArcpTallyGrouping } from '@/modules/arcp-claims/services/table';
import { readArcpFromPostgresClient } from '@/lib/read-model/client-flags';
import { useArcpClaimsLabels } from './useArcpClaimsLabels';
import { useArcpClaimsFetch } from './useArcpClaimsFetch';
import { useArcpClaimsExport } from './useArcpClaimsExport';
import { toLoadStatus } from './load-helpers';
import { type ArcpTableViewMode } from '@/modules/arcp-claims/components/ArcpClaimsSummaryPanel';

export function useArcpClaimsState() {
  const supabase = createClient();
  const chunkedAuth = useMemo(() => createChunkedFetchAuth(supabase), [supabase]);

  const {
    dateRange, setDateRange, selectedBranch, selectedFranchisee, selectedCallTypes,
    setSelectedCallTypes, callTypeOptions, offices, branchesList, franchiseesList,
    resourcesLoaded, prefsReady, handleBranchesChange, setSelectedFranchisee,
  } = useReportFilters();

  const [arcpDateFilterColumn, setArcpDateFilterColumn] = useState<ArcpDateFilterColumn>(ARCP_DEFAULT_DATE_FILTER_COLUMN);
  const [includeTravelReimbursement, setIncludeTravelReimbursement] = useState(true);
  const [tableView, setTableView] = useState<ArcpTableViewMode>('summary');
  const [tallyGrouping, setTallyGrouping] = useState<ArcpTallyGrouping>('category');
  const [tallyDetailLevel, setTallyDetailLevel] = useState<ArcpTallyDetailLevel>('full');
  const [appliedFilters, setAppliedFilters] = useState<AppliedArcpFiltersSnapshot | null>(null);

  const { alert: pageAlert, setError: setPageError, setWarning: setPageWarning, clear: clearPageAlert } = usePageAlert();
  const zeroAmountWarnedRef = useRef<string | null>(null);
  const arcpBootstrapRef = useRef(false);

  const { arcpCoverage, setArcpCoverage, arcpCrmLabelLookups, arcpLabelLookups } = useArcpClaimsLabels({
    supabase, chunkedAuth, resourcesLoaded, callTypeOptions,
  });

  const loadEstimateHints = useMemo(() => ({ usePostgres: readArcpFromPostgresClient(), coverage: arcpCoverage }), [arcpCoverage]);

  const { loading, loadStatus, rawAggregateRows, setRawAggregateRows, runLoad } = useArcpClaimsFetch({
    supabase, chunkedAuth, loadEstimateHints, setArcpCoverage, setPageError, setPageWarning, clearPageAlert,
  });

  const {
    exportingDetail, exportingPdf, pdfViewerOpen, pdfViewerUrl, pdfFileName,
    detailExportStatus, detailExportRunningTotals, closePdfViewer, handleExportCsv,
    handleViewPdf, handleExportDetailCsv,
  } = useArcpClaimsExport({ supabase, chunkedAuth, setPageWarning });

  const startDateStr = useMemo(() => toDateString(dateRange.start), [dateRange.start]);
  const endDateStr = useMemo(() => toDateString(dateRange.end), [dateRange.end]);
  const callTypeParam = useMemo(() => (selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',')), [selectedCallTypes]);
  const branchParam = useMemo(() => joinFilterParam(selectedBranch) ?? '', [selectedBranch]);
  const franchiseeParam = useMemo(() => joinFilterParam(selectedFranchisee) ?? '', [selectedFranchisee]);

  const branchLabel = useMemo(() => getBranchLabel(selectedBranch, appliedFilters?.selectedBranch, offices, branchesList), [appliedFilters?.selectedBranch, selectedBranch, offices, branchesList]);
  const franchiseeLabel = useMemo(() => getFranchiseeLabel(selectedFranchisee, appliedFilters?.selectedFranchisee, selectedBranch, appliedFilters?.selectedBranch, offices, franchiseesList), [appliedFilters?.selectedFranchisee, appliedFilters?.selectedBranch, selectedFranchisee, selectedBranch, offices, franchiseesList]);
  const callTypeLabel = useMemo(() => getCallTypeLabel(selectedCallTypes, appliedFilters?.selectedCallTypes), [appliedFilters?.selectedCallTypes, selectedCallTypes]);
  const dateBasisLabel = useMemo(() => getDateBasisLabel(arcpDateFilterColumn, appliedFilters?.arcpDateFilterColumn), [appliedFilters?.arcpDateFilterColumn, arcpDateFilterColumn]);

  const draftFilters = useMemo((): AppliedArcpFiltersSnapshot => ({
    startDateStr, endDateStr, arcpDateFilterColumn, branchParam, franchiseeParam, callTypeParam,
    selectedBranch, selectedFranchisee, selectedCallTypes,
  }), [startDateStr, endDateStr, arcpDateFilterColumn, branchParam, franchiseeParam, callTypeParam, selectedBranch, selectedFranchisee, selectedCallTypes]);

  const draftQueryKey = useMemo(() => appliedArcpFiltersKey(draftFilters), [draftFilters]);
  const appliedQueryKey = useMemo(() => (appliedFilters ? appliedArcpFiltersKey(appliedFilters) : null), [appliedFilters]);
  const hasPendingFilterChanges = appliedQueryKey !== draftQueryKey;

  const mergedAggregateRows = useMemo(() => {
    if (!rawAggregateRows?.length) return [];
    const merged = mergeArcpAggregateRows(rawAggregateRows);
    return arcpCrmLabelLookups ? enrichArcpAggregateLabelsClient(merged, arcpCrmLabelLookups) : merged;
  }, [rawAggregateRows, arcpCrmLabelLookups]);

  const tableModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, {
      includeTravel: includeTravelReimbursement, grouping: tallyGrouping, ...arcpLabelLookups,
    });
  }, [mergedAggregateRows, includeTravelReimbursement, tallyGrouping, arcpLabelLookups]);

  const fullModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, { includeTravel: true, ...arcpLabelLookups });
  }, [mergedAggregateRows, arcpLabelLookups]);

  const summaryTotals = useMemo(() => {
    const lineCounts = deriveArcpGrandTotalsFromAggregates(mergedAggregateRows);
    const exportTotals = tableModel?.totals ?? fullModel?.totals;
    return {
      serviceLineCount: lineCounts.serviceLineCount,
      travelLineCount: lineCounts.travelLineCount,
      amountPayable: exportTotals?.amountPayable ?? lineCounts.amountPayable,
      branchApproved: exportTotals?.branchApproved ?? lineCounts.branchApproved,
      hoApproved: exportTotals?.hoApproved ?? lineCounts.hoApproved,
    };
  }, [mergedAggregateRows, fullModel, tableModel]);

  const categorySectionCount = useMemo(() => (tableModel ? countArcpCategorySections(tableModel) : 0), [tableModel]);
  const displayModel = useMemo(() => tableModel ? applyArcpTallyDetailLevel(tableModel, tallyDetailLevel) : null, [tableModel, tallyDetailLevel]);

  useEffect(() => {
    if (loading || !appliedFilters || mergedAggregateRows.length === 0) return;
    const { serviceLineCount, amountPayable, branchApproved, hoApproved } = summaryTotals;
    const warnKey = appliedArcpFiltersKey(appliedFilters);
    if (serviceLineCount > 0 && amountPayable === 0 && branchApproved === 0 && hoApproved === 0 && zeroAmountWarnedRef.current !== warnKey) {
      zeroAmountWarnedRef.current = warnKey;
      setPageWarning('Rows loaded but Amount Payable / Branch / HO are all zero for this date basis. Try a wider range or Call Date filter.');
    }
  }, [loading, appliedFilters, mergedAggregateRows.length, summaryTotals, setPageWarning]);

  const hasNoResults = Boolean(appliedFilters && !loading && mergedAggregateRows.length === 0);

  const monthlyBreakdown = useMemo(() => {
    if (!rawAggregateRows?.length) return null;
    const enriched = arcpCrmLabelLookups ? enrichArcpAggregateLabelsClient(rawAggregateRows, arcpCrmLabelLookups) : rawAggregateRows;
    return enriched.length > 0 ? buildArcpClaimsMonthlyBreakdown(enriched, { includeTravel: includeTravelReimbursement }) : null;
  }, [rawAggregateRows, arcpCrmLabelLookups, includeTravelReimbursement]);

  const canExportPdf = useMemo(() => {
    if (!appliedFilters || !tableModel) return false;
    if (tableView === 'monthly') return (monthlyBreakdown?.rows.length ?? 0) > 0;
    return (displayModel?.rows.length ?? 0) > 0 || tallyDetailLevel === 'totals';
  }, [appliedFilters, tableModel, tableView, monthlyBreakdown, displayModel, tallyDetailLevel]);

  const draftQueryOpts = useMemo(() => arcpQueryOptsFromFilters(draftFilters), [draftFilters]);
  const draftLoadPlan = useMemo(() => resolveArcpClientLoadPlan(draftQueryOpts, loadEstimateHints), [draftQueryOpts, loadEstimateHints]);

  const appliedLoadPlan = useMemo(() => {
    if (!appliedFilters) return null;
    return resolveArcpClientLoadPlan(arcpQueryOptsFromFilters(appliedFilters), loadEstimateHints);
  }, [appliedFilters, loadEstimateHints]);

  const draftLoadPreview = useMemo(() => {
    if (!draftLoadPlan.isLongLoad || loading) return null;
    return toLoadStatus(draftLoadPlan, arcpDateFilterColumn, 0, draftLoadPlan.estimateMs, {
      scopedFilters: Boolean(branchParam || franchiseeParam),
    });
  }, [draftLoadPlan, arcpDateFilterColumn, loading, branchParam, franchiseeParam]);

  const pageScopeSubtitle = useMemo(() => {
    const filters = appliedFilters ?? { startDateStr, endDateStr, selectedBranch, selectedFranchisee };
    return formatReportScopeSubtitle(
      { start: new Date(`${filters.startDateStr}T00:00:00`), end: new Date(`${filters.endDateStr}T00:00:00`), label: `${filters.startDateStr} → ${filters.endDateStr}` },
      filters.selectedBranch.length, filters.selectedFranchisee.length
    );
  }, [appliedFilters, startDateStr, endDateStr, selectedBranch, selectedFranchisee]);

  const wideScopeLoad = useMemo(() => isWideOrganizationScope(
    appliedFilters?.selectedBranch ?? selectedBranch, appliedFilters?.selectedFranchisee ?? selectedFranchisee
  ), [appliedFilters, selectedBranch, selectedFranchisee]);

  const buildDraftFiltersSnapshot = useCallback((dateColumn = arcpDateFilterColumn): AppliedArcpFiltersSnapshot => ({
    startDateStr, endDateStr, arcpDateFilterColumn: dateColumn, branchParam, franchiseeParam, callTypeParam,
    selectedBranch: [...selectedBranch], selectedFranchisee: [...selectedFranchisee], selectedCallTypes: [...selectedCallTypes],
  }), [arcpDateFilterColumn, branchParam, callTypeParam, endDateStr, franchiseeParam, selectedBranch, selectedCallTypes, selectedFranchisee, startDateStr]);

  const applyRestoredSession = useCallback((restored: AppliedArcpFiltersSnapshot, partial: ArcpClaimsAggregateRow[] | undefined, resumable: boolean) => {
    setArcpDateFilterColumn(restored.arcpDateFilterColumn);
    setDateRange({ start: new Date(`${restored.startDateStr}T00:00:00`), end: new Date(`${restored.endDateStr}T00:00:00`), label: `${restored.startDateStr} → ${restored.endDateStr}` });
    handleBranchesChange(restored.selectedBranch);
    setSelectedFranchisee(restored.selectedFranchisee);
    setSelectedCallTypes(restored.selectedCallTypes);
    setAppliedFilters(restored);
    setRawAggregateRows(partial?.length ? mergeArcpAggregateRows(partial, ARCP_MERGE_ACROSS_CHUNKS) : null);
    if (resumable) runLoad(restored, false);
  }, [handleBranchesChange, runLoad, setDateRange, setSelectedCallTypes, setSelectedFranchisee, setRawAggregateRows]);

  const handleApplyFilters = useCallback(() => {
    const next = buildDraftFiltersSnapshot();
    const nextKey = appliedArcpFiltersKey(next);
    if (loading && nextKey === appliedQueryKey) return;
    setAppliedFilters(next);
    if (nextKey !== appliedQueryKey) setRawAggregateRows(null);
    runLoad(next, false);
  }, [buildDraftFiltersSnapshot, runLoad, appliedQueryKey, loading, setRawAggregateRows]);

  useEffect(() => {
    if (!resourcesLoaded || !prefsReady || arcpBootstrapRef.current) return;
    arcpBootstrapRef.current = true;
    const dateColumn = arcpDateFilterColumn;
    void (async () => {
      try {
        const status = await chunkedAuth.getWithAuthRetry<{ jobId?: string; filters?: Record<string, unknown>; partialAggregates?: ArcpClaimsAggregateRow[]; resumable?: boolean }>('/api/report/arcp-claims/load-status', { params: { kind: 'agg', latest: 'any' } });
        if (status.jobId) {
          const restored = filtersFromLoadJobSnapshot(status.filters ?? {});
          const draftKey = appliedArcpFiltersKey(buildDraftFiltersSnapshot(dateColumn));
          if (restored && appliedArcpFiltersKey(restored) === draftKey && (status.resumable || (status.partialAggregates?.length ?? 0) > 0)) {
            applyRestoredSession(restored, status.partialAggregates, Boolean(status.resumable));
            return;
          }
        }
      } catch { /* ignored */ }
      const next = buildDraftFiltersSnapshot(dateColumn);
      setAppliedFilters(next);
      runLoad(next, false);
    })();
  }, [resourcesLoaded, prefsReady, chunkedAuth, applyRestoredSession, runLoad, arcpDateFilterColumn, buildDraftFiltersSnapshot]);

  const onExportCsv = useCallback(() => handleExportCsv(appliedFilters, displayModel, tableModel, tallyDetailLevel), [handleExportCsv, appliedFilters, displayModel, tableModel, tallyDetailLevel]);
  const onViewPdf = useCallback(() => handleViewPdf(appliedFilters, tableModel, displayModel, monthlyBreakdown, tableView, tallyDetailLevel, includeTravelReimbursement, canExportPdf, { dateBasisLabel, branchLabel, franchiseeLabel, callTypeLabel }), [handleViewPdf, appliedFilters, tableModel, displayModel, monthlyBreakdown, tableView, tallyDetailLevel, includeTravelReimbursement, canExportPdf, dateBasisLabel, branchLabel, franchiseeLabel, callTypeLabel]);
  const onExportDetail = useCallback(() => handleExportDetailCsv(appliedFilters, tableModel, includeTravelReimbursement, summaryTotals, arcpCoverage, setArcpCoverage, loading), [handleExportDetailCsv, appliedFilters, tableModel, includeTravelReimbursement, summaryTotals, arcpCoverage, setArcpCoverage, loading]);

  return {
    dateRange, setDateRange, selectedBranch, selectedFranchisee, selectedCallTypes, setSelectedCallTypes,
    callTypeOptions, offices, branchesList, franchiseesList, resourcesLoaded, prefsReady, handleBranchesChange, setSelectedFranchisee,
    arcpDateFilterColumn, setArcpDateFilterColumn, includeTravelReimbursement, onIncludeTravelChange: setIncludeTravelReimbursement,
    tableView, setTableView, tallyGrouping, onTallyGroupingChange: setTallyGrouping, tallyDetailLevel, onTallyDetailLevelChange: setTallyDetailLevel,
    appliedFilters, pageAlert, clearPageAlert, loading, loadStatus, appliedLoadPlan, draftLoadPreview, wideScopeLoad, pageScopeSubtitle,
    mergedAggregateRows, tableModel, summaryTotals, categorySectionCount, displayModel, monthlyBreakdown, canExportPdf,
    hasPendingFilterChanges, hasNoResults, exportingDetail, exportingPdf, pdfViewerOpen, pdfViewerUrl, pdfFileName,
    detailExportStatus, detailExportRunningTotals, closePdfViewer, onExportCsv, onViewPdf, onExportDetail, handleApplyFilters, dateBasisLabel,
  };
}
