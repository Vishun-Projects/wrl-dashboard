'use client';

import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

export function RestoredViewBanner() {
  const {
    restoredFromServer,
    restoredViewSummary,
    restoredBannerDismissed,
    dismissRestoredBanner,
    resetReportDefaults,
  } = useReportFilters();

  if (!restoredFromServer || restoredBannerDismissed || !restoredViewSummary) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
      <span className="ui-label text-slate-500">Your usual view</span>
      <span className="text-slate-700">{restoredViewSummary}</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => void resetReportDefaults()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-white hover:text-slate-900 transition-colors ui-label"
        >
          <RotateCcw size={11} />
          Reset
        </button>
        <button
          type="button"
          onClick={dismissRestoredBanner}
          className="inline-flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 transition-colors"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
