'use client';

import React, { useCallback, useMemo } from 'react';
import { Download, X } from 'lucide-react';
import { ARCP_PDF_PAGE_WIDTH_MM } from '@/features/arcp/services/pdf';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';

const PDF_PAGE_WIDTH_MM = ARCP_PDF_PAGE_WIDTH_MM;

type ArcpClaimsPdfViewerProps = {
  open: boolean;
  pdfUrl: string | null;
  fileName: string;
  onClose: () => void;
};

export function ArcpClaimsPdfViewer({ open, pdfUrl, fileName, onClose }: ArcpClaimsPdfViewerProps) {
  const iframeSrc = useMemo(() => {
    if (!pdfUrl) return null;
    return `${pdfUrl}#view=FitW&toolbar=1&navpanes=0`;
  }, [pdfUrl]);

  const handleDownload = useCallback(async () => {
    if (!pdfUrl) return;
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = fileName;
    link.rel = 'noopener';
    link.style.position = 'fixed';
    link.style.left = '-9999px';
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
  }, [fileName, pdfUrl]);

  if (!open || !pdfUrl || !iframeSrc) return null;

  const panelWidth = `min(${PDF_PAGE_WIDTH_MM}mm, calc(100vw - 2rem))`;

  return (
    <ModalPortal open={open}>
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <ModalBackdrop onClick={onClose} />
      <div
        className="relative z-[1] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-bg-canvas shadow-2xl"
        style={{
          width: panelWidth,
          height: 'calc(100vh - 2rem)',
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-bg-soft px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-900">ARCP Claims Statement</p>
            <p className="truncate text-[10px] text-slate-500">{fileName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-bg-canvas px-2.5 py-1.5 text-[10px] font-medium text-slate-700 shadow-sm hover:bg-bg-soft"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-bg-canvas px-2.5 py-1.5 text-[10px] font-medium text-slate-700 shadow-sm hover:bg-bg-soft"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>
        <iframe
          title={fileName}
          src={iframeSrc}
          className="min-h-0 w-full flex-1 bg-bg-canvas"
        />
      </div>
    </div>
    </ModalPortal>
  );
}
