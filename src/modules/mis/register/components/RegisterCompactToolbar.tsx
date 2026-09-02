'use client';

import React, { useMemo } from 'react';
import { Search, MapPin, SlidersHorizontal } from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import {
  buildFranchiseeOptions,
  buildMainBranchOptions,
  countActiveFilters,
} from '@/modules/mis';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';

type RegisterCompactToolbarProps = {
  onOpenFilters: () => void;
  onSearchEnter?: () => void;
  onPincodeEnter?: () => void;
  extraFilterCount?: number;
};

export function RegisterCompactToolbar({
  onOpenFilters,
  onSearchEnter,
  onPincodeEnter,
  extraFilterCount = 0,
}: RegisterCompactToolbarProps) {
  const {
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

  const dateColumnOptions = useMemo(
    () => dateFilterColumnOptions.map((opt) => ({ value: opt.value, label: opt.label })),
    [dateFilterColumnOptions]
  );

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
        <FilterSelect
          label="Date column"
          emptyLabel="Date column"
          mode="single"
          options={dateColumnOptions}
          selected={dateFilterColumn ? [dateFilterColumn] : []}
          onChange={(values) =>
            setDateFilterColumn((values[0] ?? dateFilterColumn) as typeof dateFilterColumn)
          }
          layout="inline"
          panelClassName="w-64"
        />
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
    </div>
  );
}
