'use client';

import React, { useMemo } from 'react';
import { Filter, Search, MapPin, SlidersHorizontal } from 'lucide-react';
import { DateRangeSelector } from '@/components/register/DateRangeSelector';
import {
  buildFranchiseeOptions,
  buildMainBranchOptions,
  countActiveFilters,
} from '@/lib/report/filters';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

type RegisterCompactToolbarProps = {
  onOpenFilters: () => void;
  onSearchEnter?: () => void;
  onPincodeEnter?: () => void;
  onApply?: () => void;
  applyDisabled?: boolean;
  applyLabel?: string;
  extraFilterCount?: number;
};

export function RegisterCompactToolbar({
  onOpenFilters,
  onSearchEnter,
  onPincodeEnter,
  onApply,
  applyDisabled = false,
  applyLabel = 'Apply filters',
  extraFilterCount = 0,
}: RegisterCompactToolbarProps) {
  const {
    hasPendingFilterChanges,
    search,
    setSearch,
    pincodeSearch,
    setPincodeSearch,
    dateRange,
    setDateRange,
    dateFilterColumn,
    setDateFilterColumn,
    dateFilterColumnOptions,
    selectedStatus,
    selectedCallTypes,
    priorityFilter,
    portalFilter,
    repairFilter,
    selectedState,
    selectedCity,
    selectedRegion,
    selectedAccount,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    offices,
    branchesList,
    franchiseesList,
    callTypeOptions,
    stateOptions,
    cityOptions,
    regionOptions,
    accountOptions,
    technicianOptions,
  } = useReportFilters();

  const branchOptions = useMemo(
    () => buildMainBranchOptions(offices, branchesList),
    [offices, branchesList]
  );
  const franchiseeOptions = useMemo(
    () => buildFranchiseeOptions(offices, selectedBranch, franchiseesList),
    [offices, selectedBranch, franchiseesList]
  );

  const resolveLabel = (field: string, value: string) => {
    if (field === 'selectedBranch') return branchOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedFranchisee') return franchiseeOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedCallTypes') return callTypeOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedState') return stateOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedCity') return cityOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedRegion') return regionOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedAccount') return accountOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedTechnician') return technicianOptions.find((o) => o.value === value)?.label || value;
    return value;
  };

  const filterCount = countActiveFilters({
    search,
    pincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedStatus,
    selectedCallTypes,
    priorityFilter,
    portalFilter,
    repairFilter,
    selectedState,
    selectedCity,
    selectedRegion,
    selectedAccount,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedOfficeIds: [],
    resolveLabel,
  });

  return (
    <div className="register-compact-toolbar register-page-filters-surface">
      <div className="register-compact-toolbar-search">
        <Search className="register-compact-toolbar-icon" />
        <input
          type="text"
          placeholder="Search by ID, customer, serial, TRN, region, account…"
          className="register-compact-toolbar-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearchEnter?.()}
        />
      </div>

      <div className="register-compact-toolbar-pincode">
        <MapPin className="register-compact-toolbar-icon" />
        <input
          type="text"
          placeholder="Pincode"
          className="register-compact-toolbar-input font-mono"
          value={pincodeSearch}
          onChange={(e) => setPincodeSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onPincodeEnter?.()}
        />
      </div>

      <div className="register-compact-toolbar-date">
        <select
          className="register-filter-select register-date-column-select"
          value={dateFilterColumn}
          onChange={(e) => setDateFilterColumn(e.target.value as typeof dateFilterColumn)}
          title="Which date column to filter"
          aria-label="Date column for range filter"
        >
          {dateFilterColumnOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <DateRangeSelector
          value={dateRange.label}
          startDate={dateRange.start}
          endDate={dateRange.end}
          onChange={(range) => setDateRange(range)}
        />
      </div>

      <button type="button" onClick={onOpenFilters} className="register-compact-toolbar-filters-btn">
        <SlidersHorizontal size={14} />
        <span>Filters</span>
        {filterCount + extraFilterCount > 0 && (
          <span className="register-compact-toolbar-filters-badge">
            {filterCount + extraFilterCount}
          </span>
        )}
      </button>

      {onApply && (
        <button
          type="button"
          onClick={onApply}
          disabled={applyDisabled}
          className={`filter-apply-btn register-compact-toolbar-apply-btn ${
            hasPendingFilterChanges ? 'filter-apply-btn--pending' : ''
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {applyLabel}
        </button>
      )}
    </div>
  );
}
