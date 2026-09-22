'use client';

import React, { useState, useRef } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { feedback } from '@/lib/ui/feedback';

type WarrantyMasterImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function WarrantyMasterImportModal({
  isOpen,
  onClose,
  onSuccess,
}: WarrantyMasterImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'merge' | 'truncate'>('merge');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ importedCount: number; totalMachines: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError(null);
      setResult(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      const name = dropped.name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
        setFile(dropped);
        setError(null);
        setResult(null);
      } else {
        setError('Please drop an Excel (.xlsx) or CSV file');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select an Excel or CSV file to import');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);

      const res = await fetch('/api/report/warranty-master/import', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        importedCount?: number;
        totalMachines?: number;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to import warranty data');
      }

      setResult({
        importedCount: data.importedCount ?? 0,
        totalMachines: data.totalMachines ?? 0,
      });
      feedback.actionSuccess(`Imported ${(data.importedCount ?? 0).toLocaleString()} machines`);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      feedback.actionFailed(msg);
    } finally {
      setUploading(false);
    }
  };

  const resetModal = () => {
    setFile(null);
    setResult(null);
    setError(null);
    onClose();
  };

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
              <p className="text-[11px] text-slate-500">Upload Excel (.xlsx) or CSV file with machine records</p>
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
          {/* Dropzone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
              file
                ? 'border-emerald-400 bg-emerald-50/30'
                : 'border-slate-200 hover:border-slate-400 bg-slate-50/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="flex flex-col items-center gap-1.5">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                <span className="text-xs font-semibold text-slate-800">{file.name}</span>
                <span className="text-[11px] text-slate-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · Click or drag to change
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <Upload className="h-8 w-8 text-slate-400" />
                <span className="text-xs font-medium text-slate-700">
                  Click to select or drag & drop Excel / CSV
                </span>
                <span className="text-[10px] text-slate-400">
                  Supports .xlsx, .xls, .csv with serial numbers, dates, models, and customers
                </span>
              </div>
            )}
          </div>

          {/* Import Mode */}
          <div className="flex items-center gap-4 text-[11px]">
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
              Replace All (truncate first)
            </label>
          </div>

          {/* Error display */}
          {error && (
            <div className="rounded-md bg-red-50 p-2.5 text-[11px] text-red-600 border border-red-200">
              {error}
            </div>
          )}

          {/* Success summary */}
          {result && (
            <div className="rounded-md bg-emerald-50 p-3 text-[11px] text-emerald-700 border border-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-800">Import Successful!</p>
                <p className="mt-0.5">
                  Processed {result.importedCount.toLocaleString()} machines. Total records in database:{' '}
                  <strong>{result.totalMachines.toLocaleString()}</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
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
              disabled={uploading || !file}
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
