'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, X } from 'lucide-react';
import {
  formatExportQueueProgress,
  type ExportQueueItem,
} from '@/lib/report/export-queue';

type ReportExportQueuePanelProps = {
  items: ExportQueueItem[];
  onClearFinished: () => void;
  onCancelItem: (id: string) => void;
};

function formatExportRelativeTime(enqueuedAt: number): string {
  const sec = Math.floor((Date.now() - enqueuedAt) / 1000);
  if (sec < 10) return 'Just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function statusSubtitle(item: ExportQueueItem): string {
  switch (item.status) {
    case 'queued':
      return `Queued · ${item.label}`;
    case 'running':
      return item.progress
        ? formatExportQueueProgress(item.progress)
        : `Preparing · ${item.label}`;
    case 'downloading':
      return `Saving · ${item.label}`;
    case 'done':
      return `${item.warning ? 'Partial' : 'Ready'} · ${item.label} · ${formatExportRelativeTime(item.enqueuedAt)}`;
    case 'failed':
      return `Failed · ${item.label}`;
    case 'cancelled':
      return `Cancelled · ${item.label}`;
  }
}

function ExportFileIcon({ filename }: { filename?: string }) {
  const name = (filename ?? '').toLowerCase();
  if (name.endsWith('.csv')) {
    return <FileText size={18} className="shrink-0 text-emerald-600" />;
  }
  return <FileSpreadsheet size={18} className="shrink-0 text-emerald-600" />;
}

export default function ReportExportQueuePanel({
  items,
  onClearFinished,
  onCancelItem,
}: ReportExportQueuePanelProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevDoneCountRef = useRef(0);

  const activeCount = items.filter(
    (item) =>
      item.status === 'queued' ||
      item.status === 'running' ||
      item.status === 'downloading' ||
      item.status === 'done'
  ).length;

  const hasFinished = items.some(
    (item) =>
      item.status === 'done' || item.status === 'failed' || item.status === 'cancelled'
  );

  const isProcessing = items.some(
    (item) =>
      item.status === 'queued' || item.status === 'running' || item.status === 'downloading'
  );

  useEffect(() => {
    const doneCount = items.filter((item) => item.status === 'done').length;
    if (doneCount > prevDoneCountRef.current) {
      setOpen(true);
    }
    prevDoneCountRef.current = doneCount;
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (!items.length) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition-all ${
          open || isProcessing
            ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
            : 'border-slate-200 bg-bg-canvas text-slate-600 hover:bg-bg-soft'
        }`}
        title="Recent exports"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {isProcessing ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Download size={14} />
        )}
        {activeCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[9px] font-bold text-white">
            {activeCount > 9 ? '9+' : activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-bg-canvas shadow-2xl"
          role="dialog"
          aria-label="Recent exports"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-800">Recent exports</span>
            <div className="flex items-center gap-2">
              {hasFinished ? (
                <button
                  type="button"
                  onClick={onClearFinished}
                  className="text-[10px] font-medium text-slate-500 hover:text-slate-800"
                >
                  Clear finished
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-0.5 text-slate-400 hover:bg-bg-soft hover:text-slate-700"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <ul className="max-h-72 overflow-y-auto inner-scrollbar">
            {items.map((item) => {
              const displayName = item.filename ?? item.label;
              const isActive =
                item.status === 'running' || item.status === 'downloading';
              const isDone = item.status === 'done';
              const isFailed = item.status === 'failed';

              return (
                <li
                  key={item.id}
                  className="flex items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 last:border-b-0 hover:bg-bg-soft/60"
                >
                  <div className="mt-0.5">
                    {isActive ? (
                      <Loader2 size={18} className="shrink-0 animate-spin text-amber-600" />
                    ) : (
                      <ExportFileIcon filename={item.filename} />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[11px] font-medium text-slate-900"
                      title={displayName}
                    >
                      {displayName}
                    </p>
                    <p
                      className={`mt-0.5 text-[10px] leading-snug ${
                        isFailed
                          ? 'text-red-600'
                          : item.warning
                            ? 'text-amber-700'
                            : 'text-slate-500'
                      }`}
                    >
                      {statusSubtitle(item)}
                    </p>
                    {item.error ? (
                      <p className="mt-0.5 text-[10px] text-red-600">{item.error}</p>
                    ) : null}
                    {item.warning ? (
                      <p className="mt-0.5 text-[10px] text-amber-700">{item.warning}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isDone && item.downloadUrl && item.filename ? (
                      <a
                        href={item.downloadUrl}
                        download={item.filename}
                        className="rounded border border-emerald-600 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50"
                      >
                        Save
                      </a>
                    ) : null}
                    {item.status === 'queued' || item.status === 'running' ? (
                      <button
                        type="button"
                        onClick={() => onCancelItem(item.id)}
                        className="text-[10px] font-medium text-slate-400 hover:text-red-600"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
