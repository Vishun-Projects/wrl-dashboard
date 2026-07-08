'use client';

import {
  formatExportQueueProgress,
  type ExportQueueItem,
} from '@/lib/report/export-queue';

type ReportExportQueueBannerProps = {
  items: ExportQueueItem[];
  onClearFinished: () => void;
  onCancelItem: (id: string) => void;
};

function statusLabel(status: ExportQueueItem['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Preparing…';
    case 'downloading':
      return 'Downloading…';
    case 'done':
      return 'Ready — click Save';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function statusClass(status: ExportQueueItem['status']): string {
  switch (status) {
    case 'queued':
      return 'text-slate-600';
    case 'running':
    case 'downloading':
      return 'text-amber-700 font-medium';
    case 'done':
      return 'text-emerald-700';
    case 'failed':
      return 'text-red-700';
    case 'cancelled':
      return 'text-slate-500';
  }
}

export default function ReportExportQueueBanner({
  items,
  onClearFinished,
  onCancelItem,
}: ReportExportQueueBannerProps) {
  if (!items.length) return null;

  const hasFinished = items.some(
    (item) =>
      item.status === 'done' || item.status === 'failed' || item.status === 'cancelled'
  );

  return (
    <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          Export queue ({items.length})
        </span>
        {hasFinished ? (
          <button
            type="button"
            onClick={onClearFinished}
            className="text-[10px] font-medium text-slate-500 hover:text-slate-800"
          >
            Clear finished
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start justify-between gap-2 text-[11px]"
          >
            <div className="min-w-0 flex items-start gap-2">
              {item.status === 'running' || item.status === 'downloading' ? (
                <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
              ) : (
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              )}
              <div className="min-w-0">
                <span className={statusClass(item.status)}>{statusLabel(item.status)}</span>
                <span className="text-slate-800"> — {item.label}</span>
                {item.progress && item.status === 'running' ? (
                  <span className="mt-0.5 block text-slate-600">
                    {formatExportQueueProgress(item.progress)}
                  </span>
                ) : null}
                {item.filename ? (
                  <span className="mt-0.5 block truncate text-slate-500">{item.filename}</span>
                ) : null}
                {item.error ? (
                  <span className="mt-0.5 block text-red-600">{item.error}</span>
                ) : null}
                {item.status === 'done' && item.downloadUrl && item.filename ? (
                  <a
                    href={item.downloadUrl}
                    download={item.filename}
                    className="mt-1 inline-flex items-center rounded border border-emerald-600 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    Save {item.filename}
                  </a>
                ) : null}
              </div>
            </div>
            {item.status === 'queued' || item.status === 'running' ? (
              <button
                type="button"
                onClick={() => onCancelItem(item.id)}
                className="shrink-0 text-[10px] font-medium text-slate-500 hover:text-red-600"
              >
                Cancel
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
