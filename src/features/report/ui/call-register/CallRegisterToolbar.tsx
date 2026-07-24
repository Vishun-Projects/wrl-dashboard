'use client';

import React, { useMemo } from 'react';
import { UiDateInput } from '@/components/ui/UiDateInput';
import { RegisterMultiSelect } from '@/features/register/ui/RegisterMultiSelect';

type CallRegisterToolbarProps = {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (val: string) => void;
  onDateToChange: (val: string) => void;
  onApplyFilter: () => void;
  onAllTime: () => void;
  onRefresh: () => void;
  loading: boolean;
  /** Options for Accounts visible (editors: full dynamic list). */
  visibilityOptions: string[];
  /** Shared allowlist draft — only shown when showVisibilityFilter is true. */
  visibleClients: string[];
  onVisibleClientsChange: (clients: string[]) => void;
  showVisibilityFilter: boolean;
  visibilityDirty: boolean;
  onSaveVisibleClients: () => void;
  savingVisible: boolean;
  /** Options for Export accounts. */
  exportOptions: string[];
  exportClients: string[];
  onExportClientsChange: (clients: string[]) => void;
  onExport: () => void;
  exporting: boolean;
  filterDirty: boolean;
};

export function CallRegisterToolbar({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onApplyFilter,
  onAllTime,
  onRefresh,
  loading,
  visibilityOptions,
  visibleClients,
  onVisibleClientsChange,
  showVisibilityFilter,
  visibilityDirty,
  onSaveVisibleClients,
  savingVisible,
  exportOptions,
  exportClients,
  onExportClientsChange,
  onExport,
  exporting,
  filterDirty,
}: CallRegisterToolbarProps) {
  const busy = loading || exporting || savingVisible;
  const visibilitySelectOptions = useMemo(
    () => visibilityOptions.map((c) => ({ value: c, label: c })),
    [visibilityOptions]
  );
  const exportSelectOptions = useMemo(
    () => exportOptions.map((c) => ({ value: c, label: c })),
    [exportOptions]
  );

  return (
    <div className="relative z-20 shrink-0 border-b border-slate-200 bg-bg-canvas px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Billing date
        </span>
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

      {showVisibilityFilter ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className={busy ? 'pointer-events-none opacity-50' : undefined}>
            <RegisterMultiSelect
              label="Accounts visible"
              emptyLabel="Accounts visible"
              options={visibilitySelectOptions}
              selected={visibleClients}
              onChange={onVisibleClientsChange}
              layout="inline"
              searchable
              showSelectAll
              selectAllLabel="Select all"
              panelClassName="w-64"
            />
          </div>
          <button
            type="button"
            disabled={busy || !visibilityDirty || visibleClients.length === 0}
            onClick={onSaveVisibleClients}
            className="h-8 shrink-0 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {savingVisible ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : null}

      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        <div className={busy ? 'pointer-events-none opacity-50' : undefined}>
          <RegisterMultiSelect
            label="Export accounts"
            emptyLabel="Export accounts"
            options={exportSelectOptions}
            selected={exportClients}
            onChange={onExportClientsChange}
            layout="inline"
            searchable
            showSelectAll
            selectAllLabel="Select all"
            panelClassName="w-64"
          />
        </div>
        <button
          type="button"
          disabled={busy || exportClients.length === 0}
          onClick={onExport}
          className={`h-8 shrink-0 rounded-md bg-teal-700 px-3 text-[12px] font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 ${
            exporting ? 'animate-pulse' : ''
          }`}
        >
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>
    </div>
  );
}
