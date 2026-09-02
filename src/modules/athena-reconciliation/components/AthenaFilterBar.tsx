'use client';

import React from 'react';
import {
  Search,
  RotateCcw,
  X,
  Sliders,
  Filter,
} from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import {
  defaultDateRange,
  formatLocalDate,
  isDefaultDateRange,
  parseLocalDateString,
  type ReportDateRange,
} from '@/modules/mis';
import type {
  AthenaBreakdownItem,
  AthenaReconciliationFilterParams,
} from '../types';

interface AthenaFilterBarProps {
  filters: AthenaReconciliationFilterParams;
  onFilterChange: (updates: Partial<AthenaReconciliationFilterParams>) => void;
  onResetFilters: () => void;
  branchOptions: AthenaBreakdownItem[];
  clientOptions: AthenaBreakdownItem[];
  callTypeOptions: AthenaBreakdownItem[];
  failureReasonOptions: AthenaBreakdownItem[];
  onOpenReasonRules?: () => void;
}

function toArray(val?: string | string[] | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function toFilterOptions(items: AthenaBreakdownItem[]): FilterSelectOption[] {
  return items.map((item) => ({
    value: item.label,
    label: item.label,
    count: item.count,
  }));
}

export function AthenaFilterBar({
  filters,
  onFilterChange,
  onResetFilters,
  branchOptions,
  clientOptions,
  callTypeOptions,
  failureReasonOptions,
  onOpenReasonRules,
}: AthenaFilterBarProps) {
  const selectedBranches = toArray(filters.branches);
  const selectedClients = toArray(filters.clients);
  const selectedCallTypes = toArray(filters.callTypes);
  const selectedFailureReasons = toArray(filters.failureReasons);

  const dateRange: ReportDateRange = {
    start: filters.startDate
      ? parseLocalDateString(filters.startDate)
      : defaultDateRange().start,
    end: filters.endDate ? parseLocalDateString(filters.endDate) : defaultDateRange().end,
    label: filters.dateRangeLabel || 'Custom Range',
  };

  const handleDateRangeChange = (range: ReportDateRange) => {
    onFilterChange({
      startDate: formatLocalDate(range.start),
      endDate: formatLocalDate(range.end),
      dateRangeLabel: range.label,
      page: 1,
    });
  };

  const activeRulesCount =
    (filters.treatAsRegisteredReasons?.length || 0) +
    (filters.excludedReasons?.length || 0);

  const totalFailuresCount = failureReasonOptions.reduce((acc, curr) => acc + curr.count, 0);

  const hasNonDefaultFilters = Boolean(
    filters.search ||
      selectedBranches.length > 0 ||
      selectedClients.length > 0 ||
      selectedCallTypes.length > 0 ||
      selectedFailureReasons.length > 0 ||
      (filters.status && filters.status !== 'ALL') ||
      activeRulesCount > 0 ||
      !isDefaultDateRange(dateRange)
  );

  const toggleFailureReasonChip = (reasonLabel: string) => {
    if (selectedFailureReasons.includes(reasonLabel)) {
      const updated = selectedFailureReasons.filter((r) => r !== reasonLabel);
      onFilterChange({
        failureReasons: updated,
        page: 1,
      });
    } else {
      const updated = [...selectedFailureReasons, reasonLabel];
      onFilterChange({
        failureReasons: updated,
        page: 1,
      });
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900/70 w-full space-y-2">
      {/* Search, date range & dropdown filters — one row */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
        <div className="shrink-0">
          <DateRangeSelector
            value={dateRange.label}
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={handleDateRangeChange}
          />
        </div>

        <div className="relative min-w-[11rem] flex-[1.25] basis-[11rem] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search Serial, Ticket, Reason..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1 pl-7 pr-6 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:focus:border-blue-400"
            value={filters.search || ''}
            onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onFilterChange({ search: '', page: 1 })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="min-w-[9rem] flex-1 basis-[9rem]">
          <FilterSelect
            label="Branch"
            emptyLabel="All Branches"
            options={toFilterOptions(branchOptions)}
            selected={selectedBranches}
            onChange={(vals) => onFilterChange({ branches: vals, page: 1 })}
            layout="inline"
            panelClassName="w-64"
          />
        </div>

        <div className="min-w-[9rem] flex-1 basis-[9rem]">
          <FilterSelect
            label="Client / Brand"
            emptyLabel="All Clients"
            options={toFilterOptions(clientOptions)}
            selected={selectedClients}
            onChange={(vals) => onFilterChange({ clients: vals, page: 1 })}
            layout="inline"
            panelClassName="w-64"
          />
        </div>

        <div className="min-w-[9rem] flex-1 basis-[9rem]">
          <FilterSelect
            label="Call Type"
            emptyLabel="All Call Types"
            options={toFilterOptions(callTypeOptions)}
            selected={selectedCallTypes}
            onChange={(vals) => onFilterChange({ callTypes: vals, page: 1 })}
            layout="inline"
            panelClassName="w-64"
          />
        </div>

        <div className="min-w-[9rem] flex-1 basis-[9rem]">
          <FilterSelect
            label="Reason"
            emptyLabel="All Failure Reasons"
            options={toFilterOptions(failureReasonOptions)}
            selected={selectedFailureReasons}
            onChange={(vals) => onFilterChange({ failureReasons: vals, page: 1 })}
            layout="inline"
            panelClassName="w-64"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto">
          {onOpenReasonRules && (
            <button
              type="button"
              onClick={onOpenReasonRules}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                activeRulesCount > 0
                  ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950/50 dark:text-purple-300 font-semibold'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Sliders className="h-3 w-3 text-purple-600 dark:text-purple-400" />
              <span>Rules {activeRulesCount > 0 ? `(${activeRulesCount})` : ''}</span>
            </button>
          )}

          {hasNonDefaultFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Failure reason count chips */}
      {failureReasonOptions.filter((item) => item.count > 0).length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0 mr-1">
            <Filter className="h-3 w-3" />
            <span>Failure Reasons:</span>
          </div>

          {/* 'All' quick filter pill */}
          <button
            type="button"
            onClick={() =>
              onFilterChange({
                failureReasons: [],
                page: 1,
              })
            }
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              selectedFailureReasons.length === 0
                ? 'bg-slate-900 text-white shadow-2xs dark:bg-blue-600'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-750'
            }`}
          >
            <span>All</span>
            {totalFailuresCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  selectedFailureReasons.length === 0
                    ? 'bg-slate-700 text-slate-100 dark:bg-blue-700'
                    : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {totalFailuresCount.toLocaleString()}
              </span>
            )}
          </button>

          {/* Individual Failure Reason Pills with live counts (Multi-Select toggle) */}
          {failureReasonOptions
            .filter((item) => item.count > 0)
            .slice(0, 10)
            .map((item) => {
              const isSelected = selectedFailureReasons.includes(item.label);
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => toggleFailureReasonChip(item.label)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white font-semibold shadow-2xs dark:bg-blue-500'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-750 border border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <span className="truncate max-w-[180px]">{item.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      isSelected
                        ? 'bg-blue-700 text-blue-100 dark:bg-blue-600'
                        : 'bg-slate-200/90 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {item.count.toLocaleString()}
                  </span>
                  {isSelected && <X className="h-2.5 w-2.5 opacity-80 hover:opacity-100" />}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
