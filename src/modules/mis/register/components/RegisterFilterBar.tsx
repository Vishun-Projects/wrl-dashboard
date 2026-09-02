'use client';

import React, { useMemo } from 'react';
import { Search, MapPin, X } from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { RegisterBranchFranchiseeFilters } from '@/modules/mis/register/components/RegisterBranchFranchiseeFilters';
import { RegisterStatusChips } from '@/modules/mis/register/components/RegisterStatusChips';
import {
  REGISTER_PORTAL_OPTIONS,
  REGISTER_PRIORITY_OPTIONS,
  REGISTER_STATUS_OPTIONS,
} from '@/modules/mis';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';
import { useRepairFilterOptions } from '@/modules/mis';

type RegisterFilterBarProps = {
  layout?: 'inline' | 'drawer-content';
  onSearchEnter?: () => void;
  onPincodeEnter?: () => void;
  showClearButton?: boolean;
  onClear?: () => void;
};

function FilterGroup({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`register-filter-group ${className}`.trim()}>
      <span className="register-filter-group-label">{label}</span>
      <div className="register-filter-group-controls">{children}</div>
    </div>
  );
}

function FilterGroups({
  showStatusChips = false,
  collapseAdvanced = false,
}: {
  showStatusChips?: boolean;
  collapseAdvanced?: boolean;
}) {
  const {
    callTypeOptions,
    selectedCallTypes,
    setSelectedCallTypes,
    selectedStatus,
    setSelectedStatus,
    priorityFilter,
    setPriorityFilter,
    portalFilter,
    setPortalFilter,
    repairFilter,
    setRepairFilter,
    stateOptions,
    selectedState,
    handleStatesChange,
    cityOptions,
    selectedCity,
    handleCitiesChange,
    regionOptions,
    selectedRegion,
    setSelectedRegion,
    accountOptions,
    selectedAccount,
    setSelectedAccount,
    technicianOptions,
    selectedTechnician,
    setSelectedTechnician,
  } = useReportFilters();

  const { options: repairOptions, loading: repairOptionsLoading } = useRepairFilterOptions();
  const [showAdvanced, setShowAdvanced] = React.useState(!collapseAdvanced);

  const advancedFilters = (
    <>
      <FilterGroup label="Location">
        <RegisterBranchFranchiseeFilters layout="block" />
        <FilterSelect
          label="Region"
          emptyLabel="All regions"
          options={regionOptions}
          selected={selectedRegion}
          onChange={setSelectedRegion}
        />
        <FilterSelect
          label="Account"
          emptyLabel="All accounts"
          options={accountOptions}
          selected={selectedAccount}
          onChange={setSelectedAccount}
        />
        <FilterSelect
          label="State"
          emptyLabel="All states"
          options={stateOptions}
          selected={selectedState}
          onChange={handleStatesChange}
        />
        <FilterSelect
          label="City"
          emptyLabel="All cities"
          options={cityOptions}
          selected={selectedCity}
          onChange={handleCitiesChange}
        />
      </FilterGroup>

      <FilterGroup label="People" className="register-filter-group--people">
        <FilterSelect
          label="Technician"
          emptyLabel="All technicians"
          options={technicianOptions}
          selected={selectedTechnician}
          onChange={setSelectedTechnician}
          panelClassName="w-64"
        />
      </FilterGroup>
    </>
  );

  return (
    <>
      <FilterGroup label="Call">
        {showStatusChips && <RegisterStatusChips />}
        <FilterSelect
          label="Status"
          emptyLabel="All statuses"
          options={REGISTER_STATUS_OPTIONS}
          selected={selectedStatus}
          onChange={setSelectedStatus}
        />
        <FilterSelect
          label="Type"
          emptyLabel="All types"
          options={callTypeOptions}
          selected={selectedCallTypes}
          onChange={setSelectedCallTypes}
        />
        <FilterSelect
          label="Priority"
          emptyLabel="All priorities"
          options={REGISTER_PRIORITY_OPTIONS}
          selected={priorityFilter}
          onChange={setPriorityFilter}
        />
        <FilterSelect
          label="Portal"
          emptyLabel="All portals"
          options={REGISTER_PORTAL_OPTIONS}
          selected={portalFilter}
          onChange={setPortalFilter}
        />
        <FilterSelect
          label="Repair done"
          emptyLabel={repairOptionsLoading ? 'Loading repair types…' : 'All repair types'}
          options={repairOptions}
          selected={repairFilter}
          onChange={setRepairFilter}
        />
      </FilterGroup>

      {collapseAdvanced && !showAdvanced ? (
        <button
          type="button"
          className="text-xs font-medium text-blue-700 hover:text-blue-900"
          onClick={() => setShowAdvanced(true)}
        >
          More filters (location, branch, technician…)
        </button>
      ) : (
        advancedFilters
      )}
      {collapseAdvanced && showAdvanced ? (
        <button
          type="button"
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
          onClick={() => setShowAdvanced(false)}
        >
          Fewer filters
        </button>
      ) : null}
    </>
  );
}

export function RegisterFilterBar({
  layout = 'inline',
  onSearchEnter,
  onPincodeEnter,
  showClearButton = true,
  onClear,
}: RegisterFilterBarProps) {
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
    isAnyFilterActive,
    clearAllFilters,
  } = useReportFilters();

  const handleClear = () => {
    clearAllFilters();
    onClear?.();
  };

  const dateColumnOptions = useMemo(
    () => dateFilterColumnOptions.map((opt) => ({ value: opt.value, label: opt.label })),
    [dateFilterColumnOptions]
  );

  if (layout === 'drawer-content') {
    return (
      <div className="register-filter-drawer-content">
        <div className="register-filter-row register-filter-row-compact flex-col items-stretch gap-3">
          <FilterGroups showStatusChips collapseAdvanced />
        </div>
      </div>
    );
  }

  return (
    <div className="register-filter-bar">
      <div className="register-filter-rows">
        <div className="register-filter-row register-filter-row-compact">
          <FilterGroup label="Search" className="register-filter-group--search">
            <div className="register-search-field">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by ID, customer, serial, TRN, region, account…"
                className="register-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSearchEnter?.()}
              />
            </div>
            <div className="register-pincode-field">
              <MapPin className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Pincode"
                className="register-search-input font-mono"
                value={pincodeSearch}
                onChange={(e) => setPincodeSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onPincodeEnter?.()}
              />
            </div>
          </FilterGroup>

          <FilterGroup label="Date range" className="register-filter-group--date">
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
            <div className="register-date-field">
              <DateRangeSelector
                value={dateRange.label}
                startDate={dateRange.start}
                endDate={dateRange.end}
                onChange={(range) => setDateRange(range)}
              />
            </div>
          </FilterGroup>

          {showClearButton && isAnyFilterActive && (
            <button
              type="button"
              onClick={handleClear}
              className="register-filter-clear-btn"
              title="Clear all filters"
            >
              <X size={13} />
              Clear all
            </button>
          )}
        </div>

        <div className="register-filter-row register-filter-row-compact">
          <FilterGroups />
        </div>
      </div>
    </div>
  );
}
