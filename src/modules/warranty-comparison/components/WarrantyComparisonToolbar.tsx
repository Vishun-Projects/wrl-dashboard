'use client';

import React from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { DateRangeSelector, type DateRange } from '@/modules/mis/register/components/DateRangeSelector';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { WarrantyComparisonFilterOptions } from '../types';

type ToolbarProps = {
  dateRangeLabel: string;
  startDate?: Date;
  endDate?: Date;
  onDateRangeChange: (range: DateRange) => void;
  search: string;
  onSearchChange: (val: string) => void;
  selectedBranches: string[];
  onBranchesChange: (branches: string[]) => void;
  selectedAccounts: string[];
  onAccountsChange: (accounts: string[]) => void;
  selectedSystemAccounts: string[];
  onSystemAccountsChange: (accounts: string[]) => void;
  selectedCallTypes: string[];
  onCallTypesChange: (types: string[]) => void;
  selectedStatuses: string[];
  onStatusesChange: (statuses: string[]) => void;
  options: WarrantyComparisonFilterOptions;
  onRefresh?: () => void;
  onExportCsv?: () => void;
  loading?: boolean;
  exporting?: boolean;
};

export function WarrantyComparisonToolbar({
  dateRangeLabel,
  startDate,
  endDate,
  onDateRangeChange,
  search,
  onSearchChange,
  selectedBranches,
  onBranchesChange,
  selectedAccounts,
  onAccountsChange,
  selectedSystemAccounts,
  onSystemAccountsChange,
  selectedCallTypes,
  onCallTypesChange,
  selectedStatuses,
  onStatusesChange,
  options,
  onRefresh,
  onExportCsv,
  loading,
  exporting,
}: ToolbarProps) {
  return (
    <div className="relative z-20 shrink-0 border-b border-slate-200 bg-bg-canvas px-3 py-1.5 flex items-center justify-between gap-2 overflow-x-auto">
      {/* Filters group: Date Range + Search + Dropdowns */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="shrink-0">
          <DateRangeSelector
            value={dateRangeLabel}
            startDate={startDate}
            endDate={endDate}
            onChange={onDateRangeChange}
            includeAllTime={false}
          />
        </div>

        {/* Search */}
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search Serial, Call No, Party..."
            className="h-8 w-44 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Dropdowns */}
        {options.branches.length > 0 && (
          <FilterSelect
            label="Branch"
            emptyLabel="All Branches"
            options={options.branches}
            selected={selectedBranches}
            onChange={onBranchesChange}
            layout="inline"
            panelClassName="w-64"
            searchable
          />
        )}

        {options.accounts.length > 0 && (
          <FilterSelect
            label="Account as per CRM"
            emptyLabel="All CRM Accounts"
            options={options.accounts}
            selected={selectedAccounts}
            onChange={onAccountsChange}
            layout="inline"
            panelClassName="w-64"
            searchable
          />
        )}
        
        {options.systemAccounts?.length > 0 && (
          <FilterSelect
            label="Account as per System"
            emptyLabel="All System Accounts"
            options={options.systemAccounts}
            selected={selectedSystemAccounts}
            onChange={onSystemAccountsChange}
            layout="inline"
            panelClassName="w-64"
            searchable
          />
        )}

        {options.callTypes.length > 0 && (
          <FilterSelect
            label="Call Type"
            emptyLabel="All Call Types"
            options={options.callTypes}
            selected={selectedCallTypes}
            onChange={onCallTypesChange}
            layout="inline"
            panelClassName="w-56"
          />
        )}

        {options.statuses && options.statuses.length > 0 && (
          <FilterSelect
            label="Status"
            emptyLabel="All Statuses"
            options={options.statuses}
            selected={selectedStatuses}
            onChange={onStatusesChange}
            layout="inline"
            panelClassName="w-56"
          />
        )}
      </div>

      {/* Optional Right group if provided */}
      {onRefresh && onExportCsv && (
        <div className="hidden lg:flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`h-3 w-3 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={onExportCsv}
            disabled={exporting || loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
            title="Export comparison to CSV"
          >
            <Download className="h-3 w-3" />
            <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
