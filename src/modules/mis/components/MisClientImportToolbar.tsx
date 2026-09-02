'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Upload, Loader2, Trash2, Download } from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import {
  estimateMisUploadEtaSec,
  formatMisUploadProgressLabel,
  runMisClientUploadQueue,
  type MisUploadProgress,
  IMPORT_FILE_UNAVAILABLE_LABEL,
  importFileRetentionTooltip,
  canManageImportFile,
} from '@/modules/mis/client-import';
import {
  isBrowserOnVercel,
  misUploadUsesExternalHost,
} from '@/modules/mis/client-import';
import {
  peekAccessTokenMeta,
  reportMisUploadTrace,
} from '@/modules/mis/client-import';
import { createClient } from '@/lib/supabase/client';
import { triggerBlobDownload } from '@/modules/mis/services/summary-excel-export';
import { downloadMisBatchFile } from '@/modules/mis/client-import';
import { feedback } from '@/lib/ui/feedback';
import { SortableTh } from '@/components/ui/SortableTh';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

type BatchMeta = {
  batchId: string;
  fileName: string;
  rowCount: number;
  activeRows: number;
  supersededRows: number;
  newRows: number;
  uploadedAt: string;
  uploadedByName: string;
  storedFilePath: string | null;
  fileRetained?: boolean;
};

type SourceMeta = {
  sourceCode: string;
  sourceName: string;
  fileKind: 'csv' | 'xlsx';
  batches: BatchMeta[];
};

type ImportStats = {
  totalRowsInFiles: number;
  totalInUse: number;
  totalSuperseded: number;
  totalNew: number;
  batchCount: number;
};

type Props = {
  uploadSource: string;
  dateScope?: { startDate: string; endDate: string } | null;
  metaRefreshKey?: number;
  onUploadSourceChange: (code: string) => void;
  onImportComplete: () => void;
};

function batchStatus(batch: BatchMeta): { label: string; className: string } {
  if (batch.activeRows <= 0) {
    return { label: 'Superseded', className: 'bg-slate-200 text-slate-600' };
  }
  if (batch.supersededRows > 0) {
    return { label: 'Partial', className: 'bg-amber-100 text-amber-800' };
  }
  if (batch.newRows === batch.rowCount) {
    return { label: 'Active · all new', className: 'bg-emerald-100 text-emerald-800' };
  }
  return { label: 'Active', className: 'bg-emerald-100 text-emerald-800' };
}

function StatChip({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'slate' | 'emerald' | 'amber' | 'indigo';
}) {
  const tones = {
    slate: 'border-slate-200 bg-bg-soft text-slate-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${tones[tone]}`}
    >
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
    </span>
  );
}

export default function MisClientImportToolbar({
  uploadSource,
  dateScope,
  metaRefreshKey = 0,
  onUploadSourceChange,
  onImportComplete,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [rowsInDateRange, setRowsInDateRange] = useState<number | null>(null);
  const [rowsInDateRangeBySource, setRowsInDateRangeBySource] = useState<Record<string, number>>({});
  const [canUpload, setCanUpload] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<MisUploadProgress | null>(null);
  const [uploadStartedAtMs, setUploadStartedAtMs] = useState<number>(0);
  const [showHistory, setShowHistory] = useState(true);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const params: Record<string, string> = {};
      if (dateScope?.startDate) params.startDate = dateScope.startDate;
      if (dateScope?.endDate) params.endDate = dateScope.endDate;
      const res = await axios.get<{
        canUpload?: boolean;
        canDelete?: boolean;
        sources: SourceMeta[];
        stats: ImportStats;
        rowsInDateRange: number | null;
        rowsInDateRangeBySource?: Record<string, number>;
      }>('/api/mis-client-import/meta', {
        withCredentials: true,
        params,
      });
      setSources(res.data.sources ?? []);
      setStats(res.data.stats ?? null);
      setCanUpload(Boolean(res.data.canUpload));
      setCanDelete(Boolean(res.data.canDelete));
      setRowsInDateRange(
        res.data.rowsInDateRange != null ? Number(res.data.rowsInDateRange) : null
      );
      setRowsInDateRangeBySource(res.data.rowsInDateRangeBySource ?? {});
    } catch {
      setSources([]);
      setStats(null);
      setCanUpload(false);
      setCanDelete(false);
      setRowsInDateRange(null);
      setRowsInDateRangeBySource({});
    } finally {
      setLoadingMeta(false);
    }
  }, [dateScope?.startDate, dateScope?.endDate]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta, metaRefreshKey]);

  const accept =
    '.csv,.wrlmis,.xlsx,.xls,text/csv,application/octet-stream,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const hasAnyBatch = sources.some((s) => s.batches.length > 0);
  type BatchRow = BatchMeta & { sourceName: string; sourceCode: string };
  type BatchSortKey =
    | 'status'
    | 'sourceName'
    | 'fileName'
    | 'rowCount'
    | 'activeRows'
    | 'supersededRows'
    | 'newRows'
    | 'uploadedAt';

  const [batchSort, setBatchSort] = useState<TableSortState<BatchSortKey> | null>({
    key: 'uploadedAt',
    dir: 'desc',
  });

  const allBatches = useMemo(() => {
    const flat: BatchRow[] = sources.flatMap((s) =>
      s.batches.map((b) => ({ ...b, sourceName: s.sourceName, sourceCode: s.sourceCode }))
    );
    if (!batchSort) {
      return [...flat].sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
    }
    return sortRows(
      flat,
      (batch) => {
        if (batchSort.key === 'status') return batchStatus(batch).label;
        if (batchSort.key === 'uploadedAt') return new Date(batch.uploadedAt).getTime();
        return batch[batchSort.key];
      },
      batchSort.dir
    );
  }, [sources, batchSort]);

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return;

    setUploading(true);
    setUploadMessage(null);
    setUploadProgress(null);
    setUploadStartedAtMs(Date.now());

    const loadingId = feedback.loading(
      files.length === 1
        ? `Importing ${files[0]!.name}…`
        : `Importing ${files.length} files…`
    );

    let anySuccess = false;
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? null;
      reportMisUploadTrace({
        phase: 'toolbar_session',
        sourceCode: uploadSource,
        fileName: files[0]?.name,
        fileSize: files[0]?.size,
        hasAccessToken: Boolean(accessToken?.trim()),
        tokenMeta: peekAccessTokenMeta(accessToken),
        uploadUrlHost: misUploadUsesExternalHost()
          ? (() => {
              try {
                return new URL(
                  process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL ?? ''
                ).host;
              } catch {
                return process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL ?? null;
              }
            })()
          : typeof window !== 'undefined'
            ? window.location.host
            : null,
        uploadMode: misUploadUsesExternalHost() ? 'direct' : 'chunked',
      });
      if (misUploadUsesExternalHost() && !accessToken) {
        feedback.dismiss(loadingId);
        feedback.actionFailed('Sign in again to upload large files to the VPS.');
        return;
      }

      const results = await runMisClientUploadQueue({
        sourceCode: uploadSource,
        files,
        accessToken,
        onProgress: (progress) => {
          setUploadProgress(progress);
          if (progress.phase === 'compressing') {
            feedback.loadingUpdate(
              loadingId,
              progress.fileName
                ? `Compressing ${progress.fileName}…`
                : 'Compressing…'
            );
          } else if (progress.phase === 'processing') {
            feedback.loadingUpdate(
              loadingId,
              progress.fileName
                ? `Processing ${progress.fileName}…`
                : 'Processing import…'
            );
          } else if (progress.total > 0) {
            const pct = Math.min(100, Math.round((progress.sent / progress.total) * 100));
            const label = progress.resuming ? 'Resuming' : 'Uploading';
            feedback.loadingUpdate(
              loadingId,
              progress.fileName
                ? `${label} ${progress.fileName}… ${pct}%`
                : `${label}… ${pct}%`
            );
          }
        },
      });

      const lines: string[] = [];
      feedback.dismiss(loadingId);

      for (const result of results) {
        if (result.error) {
          lines.push(`${result.file.name}: ${result.error}`);
          feedback.actionFailed(`Import failed: ${result.file.name}`, {
            description: result.error,
            duration: 8000,
          });
          continue;
        }
        anySuccess = true;
        const rowCount = Number(result.data?.rowCount ?? 0);
        const errorCount = Number(result.data?.errorCount ?? 0);
        const warnings = Array.isArray(result.data?.warnings)
          ? (result.data.warnings as string[])
          : [];
        const title = `${result.file.name}: imported ${rowCount.toLocaleString()} rows`;
        const details = [
          errorCount ? `${errorCount.toLocaleString()} skipped` : null,
          ...warnings,
        ].filter(Boolean) as string[];
        const warnText = details.length ? ` (${details.join('; ')})` : '';
        lines.push(title + warnText);

        if (details.length > 0) {
          feedback.actionWarning(title, {
            description: details.join('\n'),
            duration: 10_000,
          });
        } else {
          feedback.actionSuccess(title, { duration: 5000 });
        }
      }

      setUploadMessage(lines.join(' · '));

      if (anySuccess) {
        onImportComplete();
        void loadMeta();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadMessage(message);
      feedback.loadingFailed(loadingId, 'Import failed', { description: message });
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const uploadPct =
    uploadProgress && uploadProgress.total > 0
      ? Math.min(100, Math.round((uploadProgress.sent / uploadProgress.total) * 100))
      : 0;
  const uploadEtaSec =
    uploadProgress && uploadStartedAtMs > 0
      ? estimateMisUploadEtaSec(uploadProgress, uploadStartedAtMs)
      : null;

  const handleDownloadBatch = async (batchId: string, fileName: string) => {
    setDownloadingBatchId(batchId);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? null;
      const { blob, fileName: headerName } = await downloadMisBatchFile({
        batchId,
        accessToken,
      });
      const resolvedName = headerName || fileName || 'import.dat';
      await triggerBlobDownload(blob, resolvedName);
      feedback.actionSuccess(`Downloaded ${resolvedName}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Download failed';
      setUploadMessage(message);
      feedback.actionFailed('Download failed', { description: message });
    } finally {
      setDownloadingBatchId(null);
    }
  };

  const handleDeleteBatch = async (batchId: string, fileName: string) => {
    if (
      !window.confirm(
        `Delete import "${fileName}"?\n\nRows only in this file will be removed. Overlapping call numbers will fall back to an older upload if one exists.`
      )
    ) {
      return;
    }
    setDeletingBatchId(batchId);
    try {
      await axios.delete(`/api/mis-client-import/batches/${batchId}`, { withCredentials: true });
      await loadMeta();
      onImportComplete();
      setUploadMessage('Import removed.');
      feedback.actionSuccess(`Removed ${fileName}`);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Delete failed';
      setUploadMessage(message);
      feedback.actionFailed('Delete failed', { description: message });
    } finally {
      setDeletingBatchId(null);
    }
  };

  if (loadingMeta && sources.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-bg-canvas px-3 py-3 text-[11px] text-slate-500 shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading import history…
      </div>
    );
  }

  if (!canUpload && !canDelete && !hasAnyBatch) {
    return null;
  }

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-bg-canvas px-3 py-2 text-[11px] shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {canUpload && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 ui-label">Import as</span>
              <FilterSelect
                label="Import as"
                emptyLabel="Import as"
                mode="single"
                options={(sources.length ? sources : [{ sourceCode: 'coke', sourceName: 'Coke' }]).map(
                  (s) => ({ value: s.sourceCode, label: s.sourceName })
                )}
                selected={uploadSource ? [uploadSource] : []}
                onChange={(values) => onUploadSourceChange(values[0] ?? '')}
                layout="inline"
                panelClassName="w-56"
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files ? Array.from(e.target.files) : [];
                if (picked.length) void handleUploadFiles(picked);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-2.5 py-1 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {uploading ? 'Importing…' : 'Import file(s)'}
            </button>
          </>
        )}

        {uploading && uploadProgress && (
          <div className="w-full space-y-1 rounded border border-indigo-100 bg-indigo-50/50 px-2 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] text-indigo-900">
              <span>{formatMisUploadProgressLabel(uploadProgress)}</span>
              {uploadEtaSec != null && uploadProgress.phase === 'uploading' && (
                <span className="shrink-0 text-indigo-600">~{uploadEtaSec}s left</span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                style={{
                  width: `${uploadProgress.phase === 'processing' ? 100 : uploadPct}%`,
                }}
              />
            </div>
          </div>
        )}

        {canUpload && isBrowserOnVercel() && !misUploadUsesExternalHost() && (
          <p className="w-full rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
            Large files use chunked upload on Vercel. For a fast single upload, set{' '}
            <code className="text-amber-950">NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL</code> to{' '}
            <code className="text-amber-950">
              https://api.wrl-fsm.cloud/api/mis-client-import/upload
            </code>{' '}
            and redeploy.
          </p>
        )}

        {hasAnyBatch && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="ml-auto text-indigo-600 hover:underline"
          >
            {showHistory ? 'Hide import history' : 'Import history'}
          </button>
        )}
      </div>

      {hasAnyBatch && stats && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatChip label="In use" value={stats.totalInUse} tone="emerald" />
          {stats.totalSuperseded > 0 && (
            <StatChip label="Superseded" value={stats.totalSuperseded} tone="amber" />
          )}
          {rowsInDateRange != null && (
            <StatChip label="In date range" value={rowsInDateRange} tone="indigo" />
          )}
          <StatChip label="Stored in files" value={stats.totalRowsInFiles} tone="slate" />
          <span className="text-[9px] text-slate-400">
            {stats.batchCount} upload{stats.batchCount === 1 ? '' : 's'} · latest wins per call no.
          </span>
        </div>
      )}

      {hasAnyBatch && sources.length >= 1 && stats && (
        <div className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-slate-500">
          {sources.map((source) => {
            const imported = source.batches.reduce((s, b) => s + b.rowCount, 0);
            const inUse = source.batches.reduce((s, b) => s + b.activeRows, 0);
            if (imported === 0 && source.batches.length === 0) return null;
            const inRange = rowsInDateRangeBySource[source.sourceCode];
            return (
              <span key={source.sourceCode} className="rounded bg-bg-soft px-1.5 py-0.5">
                {source.sourceName}: {imported.toLocaleString()} imported
                {inUse !== imported ? ` · ${inUse.toLocaleString()} in use` : ''}
                {inRange != null ? ` · ${inRange.toLocaleString()} in date range` : ''}
              </span>
            );
          })}
        </div>
      )}

      {showHistory && allBatches.length > 0 && (
        <div className="mt-2 max-h-56 overflow-auto rounded border border-slate-100 bg-bg-soft/50">
          <table className="w-full min-w-[760px] text-left text-[10px]">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
              <tr>
                {(
                  [
                    ['status', 'Status', 'left'],
                    ['sourceName', 'Source', 'left'],
                    ['fileName', 'File', 'left'],
                    ['rowCount', 'Rows', 'right'],
                    ['activeRows', 'In use', 'right'],
                    ['supersededRows', 'Superseded', 'right'],
                    ['newRows', 'New', 'right'],
                    ['uploadedAt', 'Uploaded', 'left'],
                  ] as const
                ).map(([key, label, align]) => (
                  <SortableTh
                    key={key}
                    className={`p-1.5${align === 'right' ? ' text-right' : ''}`}
                    align={align}
                    active={batchSort?.key === key}
                    dir={batchSort?.dir}
                    onClick={() =>
                      setBatchSort((p) =>
                        toggleSort(p, key, align === 'right' || key === 'uploadedAt' ? 'desc' : 'asc')
                      )
                    }
                  >
                    {label}
                  </SortableTh>
                ))}
                <th className="ui-field-label p-1.5 text-right text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allBatches.map((batch) => {
                const status = batchStatus(batch);
                const source = sources.find((s) => s.sourceCode === batch.sourceCode);
                const latestBatch = source?.batches[0];
                const latestUploadedAtMs = latestBatch ? new Date(latestBatch.uploadedAt).getTime() : Date.now();
                
                return (
                  <tr
                    key={batch.batchId}
                    className={`border-t border-slate-100 ${batch.activeRows <= 0 ? 'opacity-60' : ''}`}
                  >
                    <td className="p-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="p-1.5">{batch.sourceName}</td>
                    <td className="p-1.5 max-w-[140px] truncate" title={batch.fileName}>
                      {batch.fileName}
                    </td>
                    <td className="p-1.5 text-right tabular-nums">{batch.rowCount.toLocaleString()}</td>
                    <td className="p-1.5 text-right font-medium tabular-nums text-emerald-700">
                      {batch.activeRows.toLocaleString()}
                    </td>
                    <td className="p-1.5 text-right tabular-nums text-slate-500">
                      {batch.supersededRows.toLocaleString()}
                    </td>
                    <td className="p-1.5 text-right tabular-nums text-indigo-700">
                      {batch.newRows.toLocaleString()}
                    </td>
                    <td className="p-1.5 whitespace-nowrap text-slate-600">
                      {new Date(batch.uploadedAt).toLocaleString()}
                    </td>
                    <td className="p-1.5">
                      <div className="flex items-center justify-end gap-1">
                        {canManageImportFile({
                          uploadedAt: batch.uploadedAt,
                          fileRetained: batch.fileRetained,
                          storedFilePath: batch.storedFilePath,
                          nowMs: latestUploadedAtMs,
                        }) ? (
                          <>
                            <button
                              type="button"
                              title="Download original file"
                              disabled={downloadingBatchId === batch.batchId}
                              onClick={() => void handleDownloadBatch(batch.batchId, batch.fileName)}
                              className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-bg-canvas px-1.5 py-0.5 text-[9px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                            >
                              {downloadingBatchId === batch.batchId ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              Download
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                title="Delete import"
                                disabled={deletingBatchId === batch.batchId}
                                onClick={() => void handleDeleteBatch(batch.batchId, batch.fileName)}
                                className="inline-flex items-center gap-0.5 rounded border border-rose-200 bg-bg-canvas px-1.5 py-0.5 text-[9px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              >
                                {deletingBatchId === batch.batchId ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                                Delete
                              </button>
                            )}
                          </>
                        ) : (
                          <span
                            title={importFileRetentionTooltip()}
                            className="inline-flex cursor-help items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium text-slate-500"
                          >
                            {IMPORT_FILE_UNAVAILABLE_LABEL}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {stats && (
              <tfoot className="sticky bottom-0 border-t border-slate-200 bg-slate-100 font-medium text-slate-700">
                <tr>
                  <td className="p-1.5" colSpan={3}>
                    Total
                  </td>
                  <td className="p-1.5 text-right tabular-nums">{stats.totalRowsInFiles.toLocaleString()}</td>
                  <td className="p-1.5 text-right tabular-nums text-emerald-700">
                    {stats.totalInUse.toLocaleString()}
                  </td>
                  <td className="p-1.5 text-right tabular-nums">{stats.totalSuperseded.toLocaleString()}</td>
                  <td className="p-1.5 text-right tabular-nums">{stats.totalNew.toLocaleString()}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {uploadMessage && <p className="mt-2 text-slate-600">{uploadMessage}</p>}
    </div>
  );
}
