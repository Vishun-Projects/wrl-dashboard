'use client';

import React from 'react';
import { Download, FileText } from 'lucide-react';

type ArcpClaimsHeaderActionsProps = {
  onExportSummary: () => void;
  onViewPdf: () => void;
  onExportDetail: () => void;
  exportSummaryDisabled: boolean;
  exportPdfDisabled: boolean;
  exportDetailDisabled: boolean;
  exportingPdf: boolean;
  exportingDetail: boolean;
};

export function ArcpClaimsHeaderActions({
  onExportSummary,
  onViewPdf,
  onExportDetail,
  exportSummaryDisabled,
  exportPdfDisabled,
  exportDetailDisabled,
  exportingPdf,
  exportingDetail,
}: ArcpClaimsHeaderActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onExportSummary}
        disabled={exportSummaryDisabled}
        title="Export summary CSV"
        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Summary</span>
      </button>
      <button
        type="button"
        onClick={onViewPdf}
        disabled={exportPdfDisabled}
        title="View PDF"
        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2.5 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        <FileText className={`h-3.5 w-3.5 ${exportingPdf ? 'animate-pulse' : ''}`} />
        <span className="hidden sm:inline">{exportingPdf ? 'PDF…' : 'PDF'}</span>
      </button>
      <button
        type="button"
        onClick={onExportDetail}
        disabled={exportDetailDisabled}
        title="Export detail CSV"
        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <Download className={`h-3.5 w-3.5 ${exportingDetail ? 'animate-pulse' : ''}`} />
        <span className="hidden sm:inline">{exportingDetail ? 'Detail…' : 'Detail'}</span>
      </button>
    </div>
  );
}
