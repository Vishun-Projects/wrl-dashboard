'use client';

import { FileSpreadsheet } from 'lucide-react';
import { PageAlert } from '@/components/ui/PageAlert';
import ReportExportQueuePanel from '@/modules/mis/components/ReportExportQueuePanel';
import { ReportOrientationBanner } from '@/modules/mis/components/ReportOrientationBanner';
import type { ExportQueueItem } from '@/modules/mis/services/export-queue';
import { formatRelativeTime, reportPerf } from '@/modules/mis/services/report-page-helpers';
import type { MisTabId } from '@/lib/auth/rbac-catalog';
import type { PageAlertState } from '@/hooks/usePageAlert';
import { feedback } from '@/lib/ui/feedback';

type Tab = { id: MisTabId; label: string };

type Props = {
  misTabs: Tab[];
  activeTab: MisTabId;
  setActiveTab: (id: MisTabId) => void;
  lastRefreshed: Date | null;
  filterUpdating: boolean;
  syncInProgress: boolean;
  corpusLoading: boolean;
  summaryTabLoading: boolean;
  bdMisTabLoading: boolean;
  total: number;
  isCurrentTabExcelExporting: boolean;
  isCurrentTabTraceExporting: boolean;
  onSync: () => void;
  onExportExcel: () => void;
  onExportTrace: () => void;
  exportQueueItems: ExportQueueItem[];
  onClearFinishedExports: () => void;
  onCancelExportJob: (id: string) => void;
  reportBanner: PageAlertState;
  onDismissBanner: () => void;
  orientationDismissed: boolean;
  userName?: string | null;
  refreshDelta: { added?: number; updated?: number } | null;
  onDismissOrientation: () => void;
};

export function ReportPageHeaderBar({
  misTabs,
  activeTab,
  setActiveTab,
  lastRefreshed,
  filterUpdating,
  syncInProgress,
  corpusLoading,
  summaryTabLoading,
  bdMisTabLoading,
  total,
  isCurrentTabExcelExporting,
  isCurrentTabTraceExporting,
  onSync,
  onExportExcel,
  onExportTrace,
  exportQueueItems,
  onClearFinishedExports,
  onCancelExportJob,
  reportBanner,
  onDismissBanner,
  orientationDismissed,
  userName,
  refreshDelta,
  onDismissOrientation,
}: Props) {
  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-bg-canvas px-4">
        <div className="flex items-center gap-6">
          <div className="flex">
            {misTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex h-14 items-center px-3 ui-help font-medium transition-all ${activeTab === tab.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {tab.label}
                {activeTab === tab.id ? (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastRefreshed ? (
            <span
              className="ui-micro"
              title={`Last refreshed: ${lastRefreshed.toLocaleString()}`}
            >
              {formatRelativeTime(lastRefreshed)}
            </span>
          ) : null}
          {filterUpdating ? (
            <span className="ui-micro text-blue-600 animate-pulse">Updating filters…</span>
          ) : null}
          {(activeTab === 'summary' ||
            activeTab === 'accounts' ||
            activeTab === 'bd_mis_summary') &&
          (syncInProgress ||
            corpusLoading ||
            filterUpdating ||
            summaryTabLoading ||
            bdMisTabLoading) ? (
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
              title="Updating summary…"
            />
          ) : null}
          <button
            onClick={() => {
              const t0 = performance.now();
              reportPerf('ui', 'Sync button → fetchDelta()', t0, {
                why: 'Incremental lastSync poll; see fetchDelta logs.',
              });
              onSync();
            }}
            disabled={syncInProgress}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-bg-canvas text-slate-700 shadow-sm transition-all hover:bg-bg-soft disabled:opacity-50"
            title="Refresh report data"
          >
            <div className={syncInProgress ? 'animate-spin' : ''}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </div>
          </button>
          {activeTab !== 'client_import' && activeTab !== 'deployment_completion' ? (
            <button
              onClick={onExportExcel}
              className="flex items-center gap-2 bg-bg-canvas text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-bg-soft transition-all shadow-sm"
              title={
                activeTab === 'bd_mis_summary'
                  ? 'Export audit workbook — how regional counts were built'
                  : total > 500
                    ? 'Export filtered register (large datasets download as CSV from server)'
                    : 'Export filtered register to Excel (.xlsx)'
              }
            >
              <FileSpreadsheet
                size={14}
                className={
                  isCurrentTabExcelExporting ? 'animate-pulse text-amber-600' : 'text-emerald-600'
                }
              />
              {isCurrentTabExcelExporting ? 'Exporting…' : 'Export Excel'}
            </button>
          ) : null}
          {activeTab === 'summary' || activeTab === 'bd_mis_summary' ? (
            <button
              type="button"
              onClick={onExportTrace}
              className="flex items-center gap-2 bg-bg-canvas text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-bg-soft transition-all shadow-sm"
              title="Export summary dashboard + full row-by-row trace (CRM, Cadbury, Coke)"
            >
              <FileSpreadsheet
                size={14}
                className={
                  isCurrentTabTraceExporting ? 'animate-pulse text-amber-600' : 'text-blue-600'
                }
              />
              {isCurrentTabTraceExporting ? 'Trace export…' : 'Export Trace'}
            </button>
          ) : null}
          <ReportExportQueuePanel
            items={exportQueueItems}
            onClearFinished={onClearFinishedExports}
            onCancelItem={(id) => {
              onCancelExportJob(id);
              feedback.cancelled('Export cancelled');
            }}
          />
        </div>
      </div>

      {reportBanner ? (
        <PageAlert
          variant={reportBanner.variant}
          message={reportBanner.message}
          onDismiss={onDismissBanner}
        />
      ) : null}

      {activeTab === 'register' && !orientationDismissed ? (
        <ReportOrientationBanner
          userName={userName ?? undefined}
          added={refreshDelta?.added}
          updated={refreshDelta?.updated}
          onDismiss={onDismissOrientation}
        />
      ) : null}
    </>
  );
}
