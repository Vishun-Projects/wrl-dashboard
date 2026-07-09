'use client';

import { useCallback, useRef, useState } from 'react';
import {
  EXPORT_QUEUE_PREP_GAP_MS,
  type ExportQueueItem,
  type ExportQueueJob,
  type ExportQueueKind,
  type ExportQueueRunContext,
} from '@/lib/report/export-queue';
import type { MisTabId } from '@/lib/auth/rbac-catalog';
import {
  triggerBlobDownload,
  type PreparedFileExport,
} from '@/lib/report/summary-excel-export';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export type UseReportExportQueueOptions = {
  onDownloadStarted?: (filename: string) => void;
  onExportComplete?: (result: { filename: string; warning?: string }) => void;
};

export function useReportExportQueue(options: UseReportExportQueueOptions = {}) {
  const onDownloadStartedRef = useRef(options.onDownloadStarted);
  onDownloadStartedRef.current = options.onDownloadStarted;
  const onExportCompleteRef = useRef(options.onExportComplete);
  onExportCompleteRef.current = options.onExportComplete;

  const queueRef = useRef<ExportQueueJob[]>([]);
  const processingRef = useRef(false);
  const currentJobIdRef = useRef<string | null>(null);
  const abortCurrentRef = useRef<(() => void) | null>(null);
  const [items, setItems] = useState<ExportQueueItem[]>([]);

  const patchItem = useCallback((id: string, patch: Partial<ExportQueueItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const pump = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift()!;
        const controller = new AbortController();
        currentJobIdRef.current = job.id;
        abortCurrentRef.current = () => controller.abort();
        patchItem(job.id, { status: 'running', progress: undefined });

        const ctx: ExportQueueRunContext = {
          signal: controller.signal,
          onProgress: (progress) => patchItem(job.id, { progress }),
        };

        try {
          const result = await job.run(ctx);
          abortCurrentRef.current = null;
          patchItem(job.id, {
            status: 'downloading',
            filename: result.filename,
            progress: undefined,
            warning: undefined,
          });
          await triggerBlobDownload(result.blob, result.filename, {
            objectUrl: result.objectUrl,
            autoRevoke: false,
          });
          patchItem(job.id, {
            status: 'done',
            filename: result.filename,
            downloadUrl: result.objectUrl,
            progress: undefined,
            warning: result.warning,
          });
          onDownloadStartedRef.current?.(result.filename);
          onExportCompleteRef.current?.({
            filename: result.filename,
            warning: result.warning,
          });
        } catch (err) {
          const cancelled =
            err instanceof DOMException && err.name === 'AbortError'
              ? true
              : err instanceof Error && err.message === 'Export cancelled';
          patchItem(job.id, {
            status: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? undefined : err instanceof Error ? err.message : 'Export failed',
            progress: undefined,
          });
        }

        abortCurrentRef.current = null;
        currentJobIdRef.current = null;

        if (queueRef.current.length > 0) {
          await delay(EXPORT_QUEUE_PREP_GAP_MS);
        }
      }
    } finally {
      processingRef.current = false;
      currentJobIdRef.current = null;
      abortCurrentRef.current = null;
    }
  }, [patchItem]);

  const enqueue = useCallback(
    (
      label: string,
      run: (ctx: ExportQueueRunContext) => Promise<PreparedFileExport>,
      meta?: { sourceTab?: MisTabId; kind?: ExportQueueKind }
    ) => {
      const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      queueRef.current.push({
        id,
        label,
        run,
        sourceTab: meta?.sourceTab,
        kind: meta?.kind ?? 'standard',
      });
      setItems((prev) => [
        ...prev,
        {
          id,
          label,
          status: 'queued',
          enqueuedAt: Date.now(),
          sourceTab: meta?.sourceTab,
          kind: meta?.kind ?? 'standard',
        },
      ]);
      void pump();
      return id;
    },
    [pump]
  );

  const cancelJob = useCallback(
    (id: string) => {
      const queuedIdx = queueRef.current.findIndex((job) => job.id === id);
      if (queuedIdx >= 0) {
        queueRef.current.splice(queuedIdx, 1);
        patchItem(id, { status: 'cancelled', progress: undefined });
        return;
      }

      if (currentJobIdRef.current === id) {
        abortCurrentRef.current?.();
        patchItem(id, { status: 'cancelled', progress: undefined });
      }
    },
    [patchItem]
  );

  const clearFinished = useCallback(() => {
    setItems((prev) => {
      for (const item of prev) {
        if (
          item.downloadUrl &&
          (item.status === 'done' || item.status === 'failed' || item.status === 'cancelled')
        ) {
          URL.revokeObjectURL(item.downloadUrl);
        }
      }
      return prev.filter(
        (item) =>
          item.status === 'queued' ||
          item.status === 'running' ||
          item.status === 'downloading'
      );
    });
  }, []);

  const queuedCount = items.filter((item) => item.status === 'queued').length;
  const runningItem =
    items.find((item) => item.status === 'running' || item.status === 'downloading') ?? null;
  const isProcessing = runningItem !== null || queuedCount > 0;

  return {
    items,
    queuedCount,
    runningItem,
    isProcessing,
    enqueue,
    cancelJob,
    clearFinished,
  };
}
