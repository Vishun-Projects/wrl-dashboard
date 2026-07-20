'use client';

import React, { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Search, MapPin, X } from 'lucide-react';
import { DateRangeSelector } from '@/components/register/DateRangeSelector';
import { RegisterMultiSelect } from '@/components/register/RegisterMultiSelect';
import { RegisterBranchFranchiseeFilters } from '@/components/register/RegisterBranchFranchiseeFilters';
import { RegisterStatusChips } from '@/components/register/RegisterStatusChips';
import {
  REGISTER_PORTAL_OPTIONS,
  REGISTER_PRIORITY_OPTIONS,
  REGISTER_STATUS_OPTIONS,
  type DraftFilterOverrides,
} from '@/lib/report/filters';

type FilterArrayField = keyof Pick<
  DraftFilterOverrides,
  | 'selectedStatus'
  | 'selectedCallTypes'
  | 'priorityFilter'
  | 'portalFilter'
  | 'repairFilter'
  | 'selectedRegion'
  | 'selectedAccount'
  | 'selectedTechnician'
>;
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import { useRepairFilterOptions } from '@/lib/report/hooks/useRepairFilterOptions';

type RegisterFilterBarProps = {
  layout?: 'inline' | 'drawer-content';
  applyMode?: 'instant' | 'confirm';
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
  applyMode = 'confirm',
  showStatusChips = false,
  commitOnChange = false,
  collapseAdvanced = false,
}: {
  applyMode?: 'instant' | 'confirm';
  showStatusChips?: boolean;
  /** In drawer: sync applied filters on each change so chips/removal work before Apply. */
  commitOnChange?: boolean;
  /** Hick's Law: hide geography/people filters until expanded. */
  collapseAdvanced?: boolean;
}) {
  const {
    applyFilters,
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

  const wrapCommit = useCallback(
    (setter: (values: string[]) => void, field: FilterArrayField) => {
      if (!commitOnChange) return setter;
      return (values: string[]) => {
        flushSync(() => setter(values));
        applyFilters({ [field]: values } as DraftFilterOverrides);
      };
    },
    [commitOnChange, applyFilters]
  );

  const onStatusChange = wrapCommit(setSelectedStatus, 'selectedStatus');
  const onCallTypesChange = wrapCommit(setSelectedCallTypes, 'selectedCallTypes');
  const onPriorityChange = wrapCommit(setPriorityFilter, 'priorityFilter');
  const onPortalChange = wrapCommit(setPortalFilter, 'portalFilter');
  const onRepairChange = wrapCommit(setRepairFilter, 'repairFilter');
  const onStateChange = commitOnChange
    ? (values: string[]) => {
        flushSync(() => handleStatesChange(values));
        applyFilters();
      }
    : handleStatesChange;
  const onCityChange = commitOnChange
    ? (values: string[]) => {
        flushSync(() => handleCitiesChange(values));
        applyFilters();
      }
    : handleCitiesChange;
  const onTechnicianChange = wrapCommit(setSelectedTechnician, 'selectedTechnician');
  const onRegionChange = wrapCommit(setSelectedRegion, 'selectedRegion');
  const onAccountChange = wrapCommit(setSelectedAccount, 'selectedAccount');
  const [showAdvanced, setShowAdvanced] = React.useState(!collapseAdvanced);

  const advancedFilters = (
    <>
      <FilterGroup label="Location">
        <RegisterBranchFranchiseeFilters applyMode={applyMode} commitOnChange={commitOnChange} />
        <RegisterMultiSelect
          label="Region"
          emptyLabel="All regions"
          options={regionOptions}
          selected={selectedRegion}
          onChange={onRegionChange}
          searchable
          applyMode={applyMode}
        />
        <RegisterMultiSelect
          label="Account"
          emptyLabel="All accounts"
          options={accountOptions}
          selected={selectedAccount}
          onChange={onAccountChange}
          searchable
          applyMode={applyMode}
        />
        <RegisterMultiSelect
          label="State"
          emptyLabel="All states"
          options={stateOptions}
          selected={selectedState}
          onChange={onStateChange}
          searchable
          applyMode={applyMode}
        />
        <RegisterMultiSelect
          label="City"
          emptyLabel="All cities"
          options={cityOptions}
          selected={selectedCity}
          onChange={onCityChange}
          searchable
          applyMode={applyMode}
        />
      </FilterGroup>

      <FilterGroup label="People" className="register-filter-group--people">
        <RegisterMultiSelect
          label="Technician"
          emptyLabel="All technicians"
          options={technicianOptions}
          selected={selectedTechnician}
          onChange={onTechnicianChange}
          searchable
          panelClassName="w-64"
          applyMode={applyMode}
        />
      </FilterGroup>
    </>
  );

  return (
    <>
      <FilterGroup label="Call">
        {showStatusChips && <RegisterStatusChips commitOnChange={commitOnChange} />}
        <RegisterMultiSelect
          label="Status"
          emptyLabel="All statuses"
          options={REGISTER_STATUS_OPTIONS}
          selected={selectedStatus}
          onChange={onStatusChange}
          applyMode={applyMode}
        />
        <RegisterMultiSelect
          label="Type"
          emptyLabel="All types"
          options={callTypeOptions}
          selected={selectedCallTypes}
          onChange={onCallTypesChange}
          applyMode={applyMode}
        />
        <RegisterMultiSelect
          label="Priority"
          emptyLabel="All priorities"
          options={REGISTER_PRIORITY_OPTIONS}
          selected={priorityFilter}
          onChange={onPriorityChange}
          applyMode={applyMode}
        />
        <RegisterMultiSelect
          label="Portal"
          emptyLabel="All portals"
          options={REGISTER_PORTAL_OPTIONS}
          selected={portalFilter}
          onChange={onPortalChange}
          applyMode={applyMode}
        />
        <RegisterMultiSelect
          label="Repair done"
          emptyLabel={repairOptionsLoading ? 'Loading repair types…' : 'All repair types'}
          options={repairOptions}
          selected={repairFilter}
          onChange={onRepairChange}
          applyMode={applyMode}
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
  applyMode = 'confirm',
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

  if (layout === 'drawer-content') {
    return (
      <div className="register-filter-drawer-content">
        <div className="register-filter-row register-filter-row-compact flex-col items-stretch gap-3">
          <FilterGroups applyMode={applyMode} showStatusChips commitOnChange collapseAdvanced />
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
          <FilterGroups applyMode={applyMode} />
        </div>
      </div>
    </div>
  );
}
