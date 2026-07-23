'use client';

import React from 'react';
import { UiDateInput } from '@/components/ui/UiDateInput';
import type { CallRegisterDateField } from '@/features/report/lib/call-register/dates';

type CallRegisterToolbarProps = {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (val: string) => void;
  onDateToChange: (val: string) => void;
  dateField: CallRegisterDateField;
  onDateFieldChange: (val: CallRegisterDateField) => void;
  onApplyFilter: () => void;
  onAllTime: () => void;
  onRefresh: () => void;
  loading: boolean;
  exportClient: string;
  exportClients: string[];
  onExportClientChange: (val: string) => void;
  onExport: () => void;
  exporting: boolean;
  filterDirty: boolean;
};

export function CallRegisterToolbar({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  dateField,
  onDateFieldChange,
  onApplyFilter,
  onAllTime,
  onRefresh,
  loading,
  exportClient,
  exportClients,
  onExportClientChange,
  onExport,
  exporting,
  filterDirty,
}: CallRegisterToolbarProps) {
  const busy = loading || exporting;
  const clients = exportClients.length > 0 ? exportClients : exportClient ? [exportClient] : [];

  return (
    <div className="relative z-20 shrink-0 border-b border-slate-200 bg-bg-canvas px-4 py-3 flex flex-wrap items-center gap-4">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Date Range
        </span>
        <select
          value={dateField}
          onChange={(e) => onDateFieldChange(e.target.value as CallRegisterDateField)}
          disabled={busy}
          aria-label="Filter date field"
          className="h-8 rounded-md border border-slate-200 bg-bg-canvas px-2 text-[12px] text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-50"
        >
          <option value="imported">Imported Date</option>
          <option value="billing">Billing Date</option>
        </select>
        <UiDateInput
          value={dateFrom}
          onChange={onDateFromChange}
          aria-label="Date from"
          disabled={busy}
        />
        <span className="text-slate-400 text-sm">–</span>
        <UiDateInput
          value={dateTo}
          onChange={onDateToChange}
          aria-label="Date to"
          disabled={busy}
        />
      </div>

      <button
        type="button"
        disabled={busy || !filterDirty}
        onClick={onApplyFilter}
        className="h-8 shrink-0 rounded-md bg-blue-600 px-3 text-[12px] font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
      >
        Apply Filter
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={onRefresh}
        className="h-8 shrink-0 rounded-md bg-white border border-slate-300 px-3 text-[12px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? 'Loading...' : 'Refresh'}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={onAllTime}
        className="h-8 shrink-0 rounded-md bg-white border border-slate-300 px-3 text-[12px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
      >
        All Time
      </button>

      <div className="flex shrink-0 items-center gap-2 ml-auto">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Export Client
        </span>
        <select
          value={exportClient}
          onChange={(e) => onExportClientChange(e.target.value)}
          disabled={busy || clients.length === 0}
          className="h-8 min-w-[11rem] rounded-md border border-slate-200 bg-bg-canvas px-2 text-[12px] text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-50"
        >
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !exportClient}
          onClick={onExport}
          className="h-8 shrink-0 rounded-md bg-teal-700 px-3 text-[12px] font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50"
        >
          {exporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>
    </div>
  );
}
