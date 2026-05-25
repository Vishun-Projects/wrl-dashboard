'use client';

import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import {
  buildActiveFilterChips,
  buildFranchiseeOptions,
  buildMainBranchOptions,
  defaultDateRange,
  type ActiveFilterChipDescriptor,
} from '@/lib/report-filters';
import { resolveRegisterDateSqlColumn } from '@/lib/trhcalls-query';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

type RegisterActiveFilterChipsProps = {
  onClearAll?: () => void;
};

export function RegisterActiveFilterChips({ onClearAll }: RegisterActiveFilterChipsProps) {
  const {
    search,
    setSearch,
    pincodeSearch,
    setPincodeSearch,
    dateRange,
    setDateRange,
    dateFilterColumn,
    setDateFilterColumn,
    selectedStatus,
    setSelectedStatus,
    selectedCallTypes,
    setSelectedCallTypes,
    priorityFilter,
    setPriorityFilter,
    portalFilter,
    setPortalFilter,
    selectedState,
    setSelectedState,
    selectedCity,
    setSelectedCity,
    selectedBranch,
    setSelectedBranch,
    selectedFranchisee,
    setSelectedFranchisee,
    selectedTechnician,
    setSelectedTechnician,
    offices,
    branchesList,
    franchiseesList,
    callTypeOptions,
    stateOptions,
    cityOptions,
    technicianOptions,
    clearAllFilters,
  } = useReportFilters();

  const branchOptions = useMemo(
    () => buildMainBranchOptions(offices, branchesList),
    [offices, branchesList]
  );
  const franchiseeOptions = useMemo(
    () => buildFranchiseeOptions(offices, selectedBranch, franchiseesList),
    [offices, selectedBranch, franchiseesList]
  );

  const resolveLabel = (field: ActiveFilterChipDescriptor['removeKey'], value: string) => {
    if (field === 'selectedBranch') return branchOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedFranchisee') return franchiseeOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedCallTypes') return callTypeOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedState') return stateOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedCity') return cityOptions.find((o) => o.value === value)?.label || value;
    if (field === 'selectedTechnician') return technicianOptions.find((o) => o.value === value)?.label || value;
    return value;
  };

  const chips = buildActiveFilterChips({
    search,
    pincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedStatus,
    selectedCallTypes,
    priorityFilter,
    portalFilter,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedOfficeIds: [],
    resolveLabel,
  });

  if (chips.length === 0) return null;

  const removeChip = (chip: ActiveFilterChipDescriptor) => {
    switch (chip.removeKey) {
      case 'search':
        setSearch('');
        break;
      case 'pincodeSearch':
        setPincodeSearch('');
        break;
      case 'dateRange':
        setDateRange(defaultDateRange());
        break;
      case 'dateFilterColumn':
        setDateFilterColumn(resolveRegisterDateSqlColumn(undefined));
        break;
      case 'selectedStatus':
        setSelectedStatus(selectedStatus.filter((v) => v !== chip.removeValue));
        break;
      case 'selectedCallTypes':
        setSelectedCallTypes(selectedCallTypes.filter((v) => v !== chip.removeValue));
        break;
      case 'priorityFilter':
        setPriorityFilter(priorityFilter.filter((v) => v !== chip.removeValue));
        break;
      case 'portalFilter':
        setPortalFilter(portalFilter.filter((v) => v !== chip.removeValue));
        break;
      case 'selectedBranch':
        setSelectedBranch(selectedBranch.filter((v) => v !== chip.removeValue));
        break;
      case 'selectedFranchisee':
        setSelectedFranchisee(selectedFranchisee.filter((v) => v !== chip.removeValue));
        break;
      case 'selectedState':
        setSelectedState(selectedState.filter((v) => v !== chip.removeValue));
        break;
      case 'selectedCity':
        setSelectedCity(selectedCity.filter((v) => v !== chip.removeValue));
        break;
      case 'selectedTechnician':
        setSelectedTechnician(selectedTechnician.filter((v) => v !== chip.removeValue));
        break;
      default:
        break;
    }
  };

  const handleClearAll = () => {
    clearAllFilters();
    setDateRange(defaultDateRange());
    setDateFilterColumn(resolveRegisterDateSqlColumn(undefined));
    onClearAll?.();
  };

  return (
    <div className="register-filter-chips">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="register-filter-chip"
          onClick={() => removeChip(chip)}
          title={`Remove ${chip.label}`}
        >
          <span className="truncate">{chip.label}</span>
          <X size={12} className="shrink-0" />
        </button>
      ))}
      <button type="button" className="register-filter-chip register-filter-chip--clear" onClick={handleClearAll}>
        Clear all
      </button>
    </div>
  );
}
