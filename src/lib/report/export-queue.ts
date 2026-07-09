export type ExportQueueStatus =
  | 'queued'
  | 'running'
  | 'downloading'
  | 'done'
  | 'failed'
  | 'cancelled';

export type ExportQueueProgress = {
  fetched: number;
  total: number;
  etaSeconds?: number;
  /** Overrides the default row counter when a recovery path is running. */
  detail?: string;
};

export type ExportQueueItem = {
  id: string;
  label: string;
  status: ExportQueueStatus;
  filename?: string;
  /** Kept alive until the user saves or clears finished exports. */
  downloadUrl?: string;
  error?: string;
  warning?: string;
  enqueuedAt: number;
  progress?: ExportQueueProgress;
};

/** Pause between consecutive downloads — reduces browser blocking across all engines. */
export const EXPORT_QUEUE_PREP_GAP_MS = 750;

export type ExportQueueRunContext = {
  signal: AbortSignal;
  onProgress: (progress: ExportQueueProgress) => void;
};

export type ExportQueueJob = {
  id: string;
  label: string;
  run: (ctx: ExportQueueRunContext) => Promise<import('@/lib/report/summary-excel-export').PreparedFileExport>;
};

export function formatExportQueueProgress(progress: ExportQueueProgress): string {
  if (progress.detail) return progress.detail;
  if (progress.total <= 0) return 'Preparing…';
  const pct = Math.min(100, Math.round((progress.fetched / progress.total) * 100));
  const base = `${progress.fetched.toLocaleString()} / ${progress.total.toLocaleString()} rows (${pct}%)`;
  if (progress.etaSeconds != null && progress.etaSeconds > 1) {
    const eta =
      progress.etaSeconds < 60
        ? `~${progress.etaSeconds}s remaining`
        : `~${Math.ceil(progress.etaSeconds / 60)}m remaining`;
    return `${base} — ${eta}`;
  }
  return base;
}
