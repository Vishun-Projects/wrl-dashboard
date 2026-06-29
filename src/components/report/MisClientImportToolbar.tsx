'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Upload, Loader2, Trash2, Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { canUploadClientMis } from '@/lib/mis-client-import/upload-access';
import { postMisClientUpload, readMisUploadError } from '@/lib/mis-client-import/upload-client';
import {
  isBrowserOnVercel,
  misUploadUsesExternalHost,
} from '@/lib/mis-client-import/upload-limits';

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
  email?: string | null;
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
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
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
  email,
  uploadSource,
  dateScope,
  metaRefreshKey = 0,
  onUploadSourceChange,
  onImportComplete,
}: Props) {
  const canUploadFallback = canUploadClientMis(email);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [rowsInDateRange, setRowsInDateRange] = useState<number | null>(null);
  const [canManageImports, setCanManageImports] = useState(canUploadFallback);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const params: Record<string, string> = {};
      if (dateScope?.startDate) params.startDate = dateScope.startDate;
      if (dateScope?.endDate) params.endDate = dateScope.endDate;
      const res = await axios.get<{
        canUpload?: boolean;
        sources: SourceMeta[];
        stats: ImportStats;
        rowsInDateRange: number | null;
      }>('/api/mis-client-import/meta', {
        withCredentials: true,
        params,
      });
      setSources(res.data.sources ?? []);
      setStats(res.data.stats ?? null);
      setCanManageImports(Boolean(res.data.canUpload));
      setRowsInDateRange(
        res.data.rowsInDateRange != null ? Number(res.data.rowsInDateRange) : null
      );
    } catch {
      setSources([]);
      setStats(null);
      setCanManageImports(canUploadFallback);
      setRowsInDateRange(null);
    } finally {
      setLoadingMeta(false);
    }
  }, [canUploadFallback, dateScope?.startDate, dateScope?.endDate]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta, metaRefreshKey]);

  const activeSource = sources.find((s) => s.sourceCode === uploadSource) ?? sources[0];
  const accept = '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const hasAnyBatch = sources.some((s) => s.batches.length > 0);
  const allBatches = sources.flatMap((s) =>
    s.batches.map((b) => ({ ...b, sourceName: s.sourceName, sourceCode: s.sourceCode }))
  );

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const data = await postMisClientUpload({
        sourceCode: uploadSource,
        file,
        accessToken: session?.access_token,
      });
      const rowCount = Number(data.rowCount ?? 0);
      const errorCount = Number(data.errorCount ?? 0);
      const warnings = Array.isArray(data.warnings) ? (data.warnings as string[]) : [];
      const warnText = warnings.length ? ` (${warnings.join('; ')})` : '';
      setUploadMessage(
        `Imported ${rowCount} rows` + (errorCount ? `, ${errorCount} skipped` : '') + warnText
      );
      await loadMeta();
      onImportComplete();
    } catch (err: unknown) {
      setUploadMessage(await readMisUploadError(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadBatch = async (batchId: string, fileName: string) => {
    setDownloadingBatchId(batchId);
    try {
      const res = await axios.get(`/api/mis-client-import/batches/${batchId}/download`, {
        withCredentials: true,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'import.dat';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      let message = 'Download failed';
      if (axios.isAxiosError(err) && err.response?.data) {
        const data = err.response.data;
        if (data instanceof Blob) {
          try {
            const parsed = JSON.parse(await data.text()) as { error?: string };
            if (parsed.error) message = parsed.error;
          } catch {
            // keep default message
          }
        } else if (typeof data === 'object' && data && 'error' in data) {
          message = String((data as { error: string }).error);
        }
      }
      setUploadMessage(message);
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
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Delete failed';
      setUploadMessage(message);
    } finally {
      setDeletingBatchId(null);
    }
  };

  if (loadingMeta && sources.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-[11px] text-slate-500 shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading import history…
      </div>
    );
  }

  if (!canManageImports && !hasAnyBatch) {
    return null;
  }

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {canManageImports && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 ui-label">Import as</span>
              <select
                value={uploadSource}
                onChange={(e) => onUploadSourceChange(e.target.value)}
                className="rounded border border-slate-200 px-2 py-1 text-slate-800"
                disabled={sources.length === 0}
              >
                {(sources.length ? sources : [{ sourceCode: 'coke', sourceName: 'Coke' }]).map((s) => (
                  <option key={s.sourceCode} value={s.sourceCode}>
                    {s.sourceName}
                  </option>
                ))}
              </select>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-2.5 py-1 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Import file
            </button>
          </>
        )}

        {canManageImports && isBrowserOnVercel() && !misUploadUsesExternalHost() && (
          <p className="w-full rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
            Vercel only accepts uploads up to ~4 MB. Large Coke/Cadbury files need the VPS upload
            endpoint — set <code className="text-amber-950">NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL</code>{' '}
            on Vercel (see scripts/vps-hosting/VERCEL_ENV.md).
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

      {hasAnyBatch && sources.length > 1 && stats && (
        <div className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-slate-500">
          {sources.map((source) => {
            const inUse = source.batches.reduce((s, b) => s + b.activeRows, 0);
            if (inUse === 0 && source.batches.length === 0) return null;
            return (
              <span key={source.sourceCode} className="rounded bg-slate-50 px-1.5 py-0.5">
                {source.sourceName}: {inUse.toLocaleString()} in use
              </span>
            );
          })}
        </div>
      )}

      {showHistory && allBatches.length > 0 && (
        <div className="mt-2 max-h-56 overflow-auto rounded border border-slate-100 bg-slate-50/50">
          <table className="w-full min-w-[760px] text-left text-[10px]">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
              <tr>
                <th className="p-1.5">Status</th>
                <th className="p-1.5">Source</th>
                <th className="p-1.5">File</th>
                <th className="p-1.5 text-right">Rows</th>
                <th className="p-1.5 text-right">In use</th>
                <th className="p-1.5 text-right">Superseded</th>
                <th className="p-1.5 text-right">New</th>
                <th className="p-1.5">Uploaded</th>
                <th className="p-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allBatches.map((batch) => {
                const status = batchStatus(batch);
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
                        <button
                          type="button"
                          title={
                            batch.storedFilePath
                              ? 'Download original file'
                              : 'Download original file (may be unavailable on serverless hosts)'
                          }
                          disabled={downloadingBatchId === batch.batchId}
                          onClick={() => void handleDownloadBatch(batch.batchId, batch.fileName)}
                          className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        >
                          {downloadingBatchId === batch.batchId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          Download
                        </button>
                        {canManageImports && (
                          <button
                            type="button"
                            title="Delete import"
                            disabled={deletingBatchId === batch.batchId}
                            onClick={() => void handleDeleteBatch(batch.batchId, batch.fileName)}
                            className="inline-flex items-center gap-0.5 rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            {deletingBatchId === batch.batchId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            Delete
                          </button>
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
