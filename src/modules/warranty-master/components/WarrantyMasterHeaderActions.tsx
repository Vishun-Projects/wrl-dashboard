'use client';

import React from 'react';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';

type WarrantyMasterHeaderActionsProps = {
  onRefresh: () => void;
  onExportCsv: () => void;
  onImportExcel?: () => void;
  refreshDisabled: boolean;
  exportDisabled: boolean;
  exporting: boolean;
  cacheLabel: string | null;
};

export function WarrantyMasterHeaderActions({
  onRefresh,
  onExportCsv,
  onImportExcel,
  refreshDisabled,
  exportDisabled,
  exporting,
  cacheLabel,
}: WarrantyMasterHeaderActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {onImportExcel ? (
        <button
          type="button"
          onClick={onImportExcel}
          title="Import Excel or CSV file"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Import Excel</span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshDisabled}
        title={cacheLabel ? `Refresh data (${cacheLabel})` : 'Refresh data'}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-bg-canvas px-2.5 text-[10px] font-medium text-slate-700 hover:bg-bg-soft disabled:opacity-50"
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
