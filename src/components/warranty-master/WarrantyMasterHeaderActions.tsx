'use client';

import React from 'react';
import { Download, RefreshCw } from 'lucide-react';

type WarrantyMasterHeaderActionsProps = {
  onRefresh: () => void;
  onExportCsv: () => void;
  refreshDisabled: boolean;
  exportDisabled: boolean;
  exporting: boolean;
  cacheLabel: string | null;
};

export function WarrantyMasterHeaderActions({
  onRefresh,
  onExportCsv,
  refreshDisabled,
  exportDisabled,
  exporting,
  cacheLabel,
}: WarrantyMasterHeaderActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshDisabled}
        title={cacheLabel ? `Refresh data (${cacheLabel})` : 'Refresh data'}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshDisabled ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
      <button
        type="button"
        onClick={onExportCsv}
        disabled={exportDisabled}
        title="Export CSV"
        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2.5 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        <Download className={`h-3.5 w-3.5 ${exporting ? 'animate-pulse' : ''}`} />
        <span className="hidden sm:inline">{exporting ? 'CSV…' : 'CSV'}</span>
      </button>
    </div>
  );
}
