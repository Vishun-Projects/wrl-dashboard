'use client';

import React, { useState, useRef } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { feedback } from '@/lib/ui/feedback';

type WarrantyMasterImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function isImportable(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
}

export function WarrantyMasterImportModal({
  isOpen,
  onClose,
  onSuccess,
}: WarrantyMasterImportModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<'merge' | 'truncate'>('merge');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{
    importedCount: number;
    totalMachines: number;
    filesProcessed: number;
    sheetsProcessed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const setSelectedFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = Array.from(list).filter((f) => isImportable(f.name));
    if (next.length === 0) {
      setError('Please select Excel (.xlsx / .xls) or CSV files');
      return;
    }
    setFiles(next);
    setError(null);
    setResult(null);
    setProgress(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(e.target.files);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setSelectedFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Please select one or more Excel or CSV files to import');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    let importedCount = 0;
    let sheetsProcessed = 0;
    let totalMachines = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const isFirst = i === 0;
        const isLast = i === files.length - 1;
        // Truncate only on the first file when Replace All is selected.
        const fileMode = mode === 'truncate' && isFirst ? 'truncate' : 'merge';
        setProgress(`Importing ${i + 1}/${files.length}: ${file.name}`);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', fileMode);
        formData.append('refreshRollup', isLast ? '1' : '0');
        // Replace All: fast path for every file in the session.
        if (mode === 'truncate') {
          formData.append('bulkReplace', '1');
          if (isFirst) formData.append('dropIndexes', '1');
          if (isLast) formData.append('rebuildIndexes', '1');
        }

        const res = await fetch('/api/report/warranty-master/import', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          importedCount?: number;
          sheetsProcessed?: number;
          totalMachines?: number;
        };

        if (!res.ok || !data.ok) {
          throw new Error(data.error || `Failed to import ${file.name}`);
        }

        importedCount += data.importedCount ?? 0;
        sheetsProcessed += data.sheetsProcessed ?? 0;
        totalMachines = data.totalMachines ?? totalMachines;
      }

      setResult({
        importedCount,
        totalMachines,
        filesProcessed: files.length,
        sheetsProcessed,
      });
      setProgress(null);
      feedback.actionSuccess(
        `Imported ${importedCount.toLocaleString()} rows from ${files.length} file(s)`
      );
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setProgress(null);
      feedback.actionFailed(msg);
    } finally {
      setUploading(false);
    }
  };

  const resetModal = () => {
    setFiles([]);
    setResult(null);
    setError(null);
    setProgress(null);
    onClose();
  };

  const totalSizeMb = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Import Warranty Master Data</h3>
              <p className="text-[11px] text-slate-500">
                Upload one or more Excel/CSV files — every sheet is imported in chunks
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetModal}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
              files.length > 0
                ? 'border-emerald-400 bg-emerald-50/30'
                : 'border-slate-200 hover:border-slate-400 bg-slate-50/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            {files.length > 0 ? (
              <div className="flex w-full flex-col items-center gap-1.5">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                <span className="text-xs font-semibold text-slate-800">
                  {files.length} file{files.length === 1 ? '' : 's'} selected
                </span>
                <span className="text-[11px] text-slate-500">
                  {totalSizeMb.toFixed(2)} MB total · Click or drag to change
                </span>
                <ul className="mt-1 max-h-28 w-full overflow-y-auto text-left text-[11px] text-slate-600">
                  {files.map((f) => (
                    <li key={`${f.name}-${f.size}`} className="truncate px-2 py-0.5">
                      {f.name}
                      <span className="text-slate-400"> · {(f.size / 1024 / 1024).toFixed(2)} MB</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <Upload className="h-8 w-8 text-slate-400" />
                <span className="text-xs font-medium text-slate-700">
                  Click to select or drag & drop Excel / CSV
                </span>
                <span className="text-[10px] text-slate-400">
                  Multi-select supported · all sheets in each workbook are imported
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px]">
            <span className="font-medium text-slate-700">Import Mode:</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
              <input
                type="radio"
                name="importMode"
                value="merge"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
                className="text-emerald-600 focus:ring-emerald-500"
              />
              Update & Merge (keep existing, add/update new)
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
              <input
                type="radio"
                name="importMode"
                value="truncate"
                checked={mode === 'truncate'}
                onChange={() => setMode('truncate')}
                className="text-red-600 focus:ring-red-500"
              />
              Replace All (truncate before first file)
            </label>
          </div>

          {progress && (
            <div className="rounded-md bg-slate-50 p-2.5 text-[11px] text-slate-600 border border-slate-200 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              {progress}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-2.5 text-[11px] text-red-600 border border-red-200">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-md bg-emerald-50 p-3 text-[11px] text-emerald-700 border border-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-800">Import Successful!</p>
                <p className="mt-0.5">
                  Processed {result.importedCount.toLocaleString()} rows from{' '}
                  {result.filesProcessed} file(s) / {result.sheetsProcessed} sheet(s). Total in
                  database: <strong>{result.totalMachines.toLocaleString()}</strong>.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={resetModal}
              disabled={uploading}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || files.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  Start Import
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
