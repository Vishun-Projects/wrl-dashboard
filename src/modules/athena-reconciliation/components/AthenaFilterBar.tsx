'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  RotateCcw,
  X,
  Calendar,
  BarChart2,
  Sliders,
  ChevronDown,
  Check,
  Filter,
  AlertCircle,
  Building2,
  Tag,
  PhoneCall,
} from 'lucide-react';
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

/**
 * ReportFilter-style searchable multi-select dropdown matching the MIS reports pattern.
 */
function AthenaFilterDropdown({
  label,
  emptyLabel,
  options,
  selected = [],
  onSelect,
  icon: Icon,
}: {
  label: string;
  emptyLabel: string;
  options: AthenaBreakdownItem[];
  selected: string[];
  onSelect: (val: string[]) => void;
  icon?: React.ComponentType<{ className?: string; size?: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const filteredOptions = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const hasSelection = selected.length > 0;

  const toggleOption = (optLabel: string) => {
    if (selected.includes(optLabel)) {
      onSelect(selected.filter((item) => item !== optLabel));
    } else {
      onSelect([...selected, optLabel]);
    }
  };

  const selectAllFiltered = () => {
    const allLabels = Array.from(
      new Set([...selected, ...filteredOptions.map((o) => o.label)])
    );
    onSelect(allLabels);
  };

  return (
    <div className="relative w-full" ref={rootRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border px-2.5 text-left text-xs transition-all ${
          hasSelection
            ? 'border-blue-300 bg-blue-50/70 font-semibold text-blue-900 shadow-2xs dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
            : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800'
        }`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {Icon && (
            <Icon
              className={`h-3.5 w-3.5 shrink-0 ${
                hasSelection ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
              }`}
            />
          )}
          <span className="truncate text-xs">
            {hasSelection ? (
              <span>
                <span className="font-normal text-slate-400">{label}: </span>
                {selected.length === 1 ? (
                  selected[0]
                ) : (
                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                    {selected.length} Selected
                  </span>
                )}
              </span>
            ) : (
              emptyLabel
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {hasSelection && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onSelect([]);
              }}
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              title="Clear selection"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown
            className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${
              open ? 'rotate-180 text-blue-600 dark:text-blue-400' : ''
            }`}
          />
        </div>
      </button>

      {/* Floating Panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-full z-[150] mt-1 w-64 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 dark:border-slate-800 dark:bg-slate-900"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-800/80">
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider dark:text-slate-300">
              {label} {hasSelection && `(${selected.length})`}
            </span>
            <div className="flex items-center gap-2">
              {filteredOptions.length > 1 && (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                >
                  Select all
                </button>
              )}
              {hasSelection && (
                <button
                  type="button"
                  onClick={() => onSelect([])}
                  className="text-[10px] text-rose-600 hover:underline dark:text-rose-400"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="border-b border-slate-100 p-1.5 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={`Filter ${label.toLowerCase()}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50/50 py-1 pl-6 pr-2 text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                autoFocus
              />
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-52 overflow-y-auto p-1 custom-scrollbar divide-y divide-slate-50 dark:divide-slate-850">
            {/* 'All' option */}
            <button
              type="button"
              onClick={() => onSelect([])}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs text-left transition-colors ${
                !hasSelection
                  ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    !hasSelection
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800'
                  }`}
                >
                  {!hasSelection && <Check size={10} strokeWidth={3} />}
                </span>
                <span>{emptyLabel}</span>
              </div>
            </button>

            {filteredOptions.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">No matching options</p>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selected.includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => toggleOption(opt.label)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate pr-2">
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          isSelected
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800'
                        }`}
                      >
                        {isSelected && <Check size={10} strokeWidth={3} />}
                      </span>
                      <span className="truncate">{opt.label}</span>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                        isSelected
                          ? 'bg-blue-200/70 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {opt.count.toLocaleString()}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
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
  const currentYear = new Date().getFullYear();
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentYearStart = `${currentYear}-01-01`;

  const selectedBranches = toArray(filters.branches || filters.branch);
  const selectedClients = toArray(filters.clients || filters.client);
  const selectedCallTypes = toArray(filters.callTypes || filters.callType);
  const selectedFailureReasons = toArray(filters.failureReasons || filters.failureReason);

  // Determine active date preset
  const isCurrentYear =
    filters.startDate === currentYearStart &&
    (!filters.endDate || filters.endDate === todayStr);
  const isAllTime = !filters.startDate && !filters.endDate;

  const handleDatePreset = (preset: 'ytd' | 'mtd' | '30d' | '7d' | 'today' | 'all') => {
    const today = new Date();
    const formatDate = (d: Date) => d.toISOString().slice(0, 10);

    if (preset === 'ytd') {
      onFilterChange({ startDate: currentYearStart, endDate: formatDate(today), page: 1 });
    } else if (preset === 'mtd') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      onFilterChange({ startDate: formatDate(start), endDate: formatDate(today), page: 1 });
    } else if (preset === '30d') {
      const past = new Date(today);
      past.setDate(past.getDate() - 30);
      onFilterChange({ startDate: formatDate(past), endDate: formatDate(today), page: 1 });
    } else if (preset === '7d') {
      const past = new Date(today);
      past.setDate(past.getDate() - 7);
      onFilterChange({ startDate: formatDate(past), endDate: formatDate(today), page: 1 });
    } else if (preset === 'today') {
      const d = formatDate(today);
      onFilterChange({ startDate: d, endDate: d, page: 1 });
    } else if (preset === 'all') {
      onFilterChange({ startDate: null, endDate: null, page: 1 });
    }
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
      filters.startDate !== currentYearStart ||
      (filters.endDate && filters.endDate !== todayStr)
  );

  const toggleFailureReasonChip = (reasonLabel: string) => {
    if (selectedFailureReasons.includes(reasonLabel)) {
      const updated = selectedFailureReasons.filter((r) => r !== reasonLabel);
      onFilterChange({
        failureReasons: updated,
        failureReason: updated.length === 1 ? updated[0] : updated.length === 0 ? null : updated,
        page: 1,
      });
    } else {
      const updated = [...selectedFailureReasons, reasonLabel];
      onFilterChange({
        failureReasons: updated,
        failureReason: updated.length === 1 ? updated[0] : updated,
        page: 1,
      });
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900/70 w-full space-y-2">
      {/* 1. Date Range Selector & Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
        {/* Date Range Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200 mr-1">
            <Calendar className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>Dates:</span>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => handleDatePreset('ytd')}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                isCurrentYear
                  ? 'bg-blue-600 text-white font-semibold shadow-2xs dark:bg-blue-500'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              Current Year ({currentYear})
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('mtd')}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              MTD
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('30d')}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              30D
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('7d')}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              7D
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('all')}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                isAllTime
                  ? 'bg-blue-600 text-white font-semibold shadow-2xs dark:bg-blue-500'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              All Time
            </button>
          </div>

          {/* Explicit Start & End Date Inputs */}
          <div className="flex items-center gap-1 ml-1 text-xs">
            <input
              type="date"
              value={filters.startDate || ''}
              onChange={(e) => onFilterChange({ startDate: e.target.value || null, page: 1 })}
              className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
            <span className="text-slate-400 text-[10px]">to</span>
            <input
              type="date"
              value={filters.endDate || ''}
              onChange={(e) => onFilterChange({ endDate: e.target.value || null, page: 1 })}
              className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-1.5">
          {/* Reason Rules & Exclusions Button */}
          {onOpenReasonRules && (
            <button
              type="button"
              onClick={onOpenReasonRules}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                activeRulesCount > 0
                  ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950/50 dark:text-purple-300 font-semibold'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Sliders className="h-3 w-3 text-purple-600 dark:text-purple-400" />
              <span>Rules {activeRulesCount > 0 ? `(${activeRulesCount})` : ''}</span>
            </button>
          )}

          {/* Reset Filters */}
          {hasNonDefaultFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Search & Multi-Select ReportFilter Dropdowns */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 w-full">
        {/* Global Search */}
        <div className="relative lg:col-span-1 sm:col-span-2">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search Serial, Ticket, Reason..."
            className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1 pl-7 pr-6 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:focus:border-blue-400"
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

        {/* Branch Filter Dropdown (Multi-Select) */}
        <div>
          <AthenaFilterDropdown
            label="Branch"
            emptyLabel="All Branches"
            options={branchOptions}
            selected={selectedBranches}
            onSelect={(vals) =>
              onFilterChange({
                branches: vals,
                branch: vals.length === 1 ? vals[0] : vals.length === 0 ? null : vals,
                page: 1,
              })
            }
            icon={Building2}
          />
        </div>

        {/* Client / Brand Filter Dropdown (Multi-Select) */}
        <div>
          <AthenaFilterDropdown
            label="Client / Brand"
            emptyLabel="All Clients"
            options={clientOptions}
            selected={selectedClients}
            onSelect={(vals) =>
              onFilterChange({
                clients: vals,
                client: vals.length === 1 ? vals[0] : vals.length === 0 ? null : vals,
                page: 1,
              })
            }
            icon={Tag}
          />
        </div>

        {/* Call Type Filter Dropdown (Multi-Select) */}
        <div>
          <AthenaFilterDropdown
            label="Call Type"
            emptyLabel="All Call Types"
            options={callTypeOptions}
            selected={selectedCallTypes}
            onSelect={(vals) =>
              onFilterChange({
                callTypes: vals,
                callType: vals.length === 1 ? vals[0] : vals.length === 0 ? null : vals,
                page: 1,
              })
            }
            icon={PhoneCall}
          />
        </div>

        {/* Failure Reason Filter Dropdown (Multi-Select) */}
        <div>
          <AthenaFilterDropdown
            label="Reason"
            emptyLabel="All Failure Reasons"
            options={failureReasonOptions}
            selected={selectedFailureReasons}
            onSelect={(vals) =>
              onFilterChange({
                failureReasons: vals,
                failureReason: vals.length === 1 ? vals[0] : vals.length === 0 ? null : vals,
                page: 1,
              })
            }
            icon={AlertCircle}
          />
        </div>
      </div>

      {/* 3. Outside Filterable Failure Reason Counts (Multi-Select Chips Bar) */}
      {failureReasonOptions.filter((item) => item.count > 0).length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 mr-1">
            <Filter className="h-2.5 w-2.5" />
            <span>Failure Reasons:</span>
          </div>

          {/* 'All' quick filter pill */}
          <button
            type="button"
            onClick={() =>
              onFilterChange({
                failureReasons: [],
                failureReason: null,
                page: 1,
              })
            }
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
              selectedFailureReasons.length === 0
                ? 'bg-slate-900 text-white shadow-2xs dark:bg-blue-600'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-750'
            }`}
          >
            <span>All</span>
            {totalFailuresCount > 0 && (
              <span
                className={`rounded-full px-1 py-0.1 text-[9px] font-bold ${
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
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white font-semibold shadow-2xs dark:bg-blue-500'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-750 border border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <span className="truncate max-w-[180px]">{item.label}</span>
                  <span
                    className={`rounded-full px-1 py-0.1 text-[9px] font-bold ${
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
