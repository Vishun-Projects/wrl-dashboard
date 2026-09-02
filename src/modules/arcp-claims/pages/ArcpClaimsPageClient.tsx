'use client';

import React from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { ArcpClaimsTable } from '@/modules/arcp-claims/components/ArcpClaimsTable';
import { ArcpClaimsSummaryPanel } from '@/modules/arcp-claims/components/ArcpClaimsSummaryPanel';
import { ArcpClaimsToolbar } from '@/modules/arcp-claims/components/ArcpClaimsToolbar';
import { ArcpClaimsHeaderActions } from '@/modules/arcp-claims/components/ArcpClaimsHeaderActions';
import { ArcpClaimsMonthlyTable } from '@/modules/arcp-claims/components/ArcpClaimsMonthlyTable';
import { ArcpClaimsLoadBanner } from '@/modules/arcp-claims/components/ArcpClaimsLoadBanner';
import { ArcpClaimsPdfViewer } from '@/modules/arcp-claims/components/ArcpClaimsPdfViewer';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { PageAlert } from '@/components/ui/PageAlert';
import { GlossaryTerm } from '@/components/ui/GlossaryTerm';
import { useArcpClaimsState } from '../hooks/useArcpClaimsState';
import { arcpChunkProgressLabel } from '../hooks/load-helpers';

export default function ArcpClaimsPage() {
  const {
    dateRange, setDateRange, selectedCallTypes, setSelectedCallTypes,
    callTypeOptions,
    arcpDateFilterColumn, setArcpDateFilterColumn, includeTravelReimbursement, onIncludeTravelChange,
    tableView, setTableView, tallyGrouping, onTallyGroupingChange, tallyDetailLevel, onTallyDetailLevelChange,
    appliedFilters, pageAlert, clearPageAlert, loading, loadStatus, appliedLoadPlan, draftLoadPreview, wideScopeLoad, pageScopeSubtitle,
    mergedAggregateRows, tableModel, summaryTotals, categorySectionCount, displayModel, monthlyBreakdown, canExportPdf,
    hasPendingFilterChanges, hasNoResults, exportingDetail, exportingPdf, pdfViewerOpen, pdfViewerUrl, pdfFileName,
    detailExportStatus, detailExportRunningTotals, closePdfViewer, onExportCsv, onViewPdf, onExportDetail, dateBasisLabel,
  } = useArcpClaimsState();

  const headerActions = (
    <ArcpClaimsHeaderActions
      onExportSummary={onExportCsv}
      onViewPdf={onViewPdf}
      onExportDetail={onExportDetail}
      exportSummaryDisabled={
        loading || !appliedFilters || !displayModel || (displayModel.rows.length === 0 && tallyDetailLevel !== 'totals')
      }
      exportPdfDisabled={loading || exportingPdf || !canExportPdf}
      exportDetailDisabled={loading || exportingDetail || !appliedFilters || !tableModel}
      exportingPdf={exportingPdf}
      exportingDetail={exportingDetail}
    />
  );

  const toolbar = (
    <ArcpClaimsToolbar
      arcpDateFilterColumn={arcpDateFilterColumn}
      onDateFilterColumnChange={setArcpDateFilterColumn}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      callTypeOptions={callTypeOptions}
      selectedCallTypes={selectedCallTypes}
      onCallTypesChange={setSelectedCallTypes}
      loading={loading}
      loadStatus={loadStatus}
      loadProgressLabel={appliedLoadPlan ? arcpChunkProgressLabel(appliedLoadPlan) : 'periods'}
    />
  );

  return (
    <PageShell
      title={
        <span className="inline-flex items-center gap-1">
          <GlossaryTerm term="ARCP" showIcon={false} />
          {' Claims'}
        </span>
      }
      subtitle={
        loading && !appliedFilters
          ? wideScopeLoad
            ? 'Loading all branches for this month…'
            : 'Loading your scope for this month…'
          : pageScopeSubtitle
      }
      icon={<FileSpreadsheet className="h-4 w-4" />}
      actions={headerActions}
      toolbar={toolbar}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
    >
      <div className="flex shrink-0 flex-col">
        {pageAlert ? (
          <div className="px-3 pt-1">
            <PageAlert
              variant={pageAlert.variant}
              message={pageAlert.message}
              onDismiss={clearPageAlert}
            />
          </div>
        ) : null}

        {!loading && draftLoadPreview && (!appliedFilters || hasPendingFilterChanges) ? (
          <div className="px-3 pt-1">
            <ArcpClaimsLoadBanner status={draftLoadPreview} variant="preview" />
          </div>
        ) : null}

        {!loading && wideScopeLoad && appliedFilters && !hasPendingFilterChanges && appliedLoadPlan?.isLongLoad ? (
          <p className="px-3 pt-1 text-[10px] text-slate-500">
            All-branch loads are slower — narrow to a branch or franchisee to refresh faster.
          </p>
        ) : null}

        {appliedFilters &&
        (mergedAggregateRows.length > 0 ||
          (loading &&
            (summaryTotals.serviceLineCount > 0 ||
              summaryTotals.amountPayable > 0 ||
              summaryTotals.branchApproved > 0 ||
              summaryTotals.hoApproved > 0))) ? (
          <ArcpClaimsSummaryPanel
            totals={summaryTotals}
            tableView={tableView}
            onTableViewChange={setTableView}
            tallyGrouping={tallyGrouping}
            onTallyGroupingChange={onTallyGroupingChange}
            tallyDetailLevel={tallyDetailLevel}
            onTallyDetailLevelChange={onTallyDetailLevelChange}
            includeTravelReimbursement={includeTravelReimbursement}
            onIncludeTravelChange={onIncludeTravelChange}
            categorySectionCount={categorySectionCount}
          />
        ) : null}

        {exportingDetail && detailExportStatus ? (
          <div className="px-3 pt-1">
            <ArcpClaimsLoadBanner
              status={detailExportStatus}
              variant="detail-export"
              runningTotals={detailExportRunningTotals}
            />
          </div>
        ) : null}

        {loading && loadStatus && !exportingDetail ? (
          <div className="px-3 pt-1">
            <ArcpClaimsLoadBanner
              status={loadStatus}
              runningTotals={
                summaryTotals.amountPayable > 0 ||
                summaryTotals.branchApproved > 0 ||
                summaryTotals.hoApproved > 0
                  ? {
                      amountPayable: summaryTotals.amountPayable,
                      branchApproved: summaryTotals.branchApproved,
                      hoApproved: summaryTotals.hoApproved,
                    }
                  : null
              }
            />
          </div>
        ) : null}
      </div>

      <PageScrollRegion>
        <div className="flex min-h-0 flex-1 flex-col">
          <AdminTableCard
            isEmpty={hasNoResults}
            empty={
              <>
                <p className="text-sm font-medium text-slate-600">No data available</p>
                <p className="text-[11px] text-slate-400">
                  No claims match <span className="font-medium text-slate-500">{dateBasisLabel}</span>{' '}
                  for {pageScopeSubtitle}. Try a different date basis or adjust your filters.
                </p>
              </>
            }
          >
            {!appliedFilters && loading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <p className="text-sm font-medium text-slate-600">
                  {wideScopeLoad
                    ? 'Loading ARCP tally for all branches this month…'
                    : 'Loading ARCP tally for your scope…'}
                </p>
              </div>
            ) : !appliedFilters && !loading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
                <p className="text-sm font-medium text-slate-600">Choose your filters, then click Apply Filter</p>
                <p className="text-[11px] text-slate-400">
                  Date basis, range, branch, franchisee, and call type can all be set before loading.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-1">
                {tableView !== 'monthly' ? (
                  <section>
                    {tableView === 'both' ? (
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Service tally
                      </h3>
                    ) : null}
                    <ArcpClaimsTable
                      model={displayModel}
                      loading={loading && mergedAggregateRows.length === 0}
                      updating={loading && mergedAggregateRows.length > 0}
                    />
                  </section>
                ) : null}
                {tableView !== 'summary' ? (
                  <section>
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Monthly breakdown
                    </h3>
                    <p className="mb-2 text-[10px] text-slate-400">
                      Each month uses the active date basis (BM approval month when BM Call Approved is
                      selected).
                    </p>
                    <ArcpClaimsMonthlyTable
                      model={monthlyBreakdown}
                      loading={loading && (monthlyBreakdown?.rows.length ?? 0) === 0}
                      updating={loading && (monthlyBreakdown?.rows.length ?? 0) > 0}
                    />
                  </section>
                ) : null}
              </div>
            )}
          </AdminTableCard>
        </div>
      </PageScrollRegion>

      <ArcpClaimsPdfViewer
        open={pdfViewerOpen}
        pdfUrl={pdfViewerUrl}
        fileName={pdfFileName}
        onClose={closePdfViewer}
      />
    </PageShell>
  );
}
