'use client';

import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import {
  buildActiveFilterChips,
  buildFranchiseeOptions,
  buildMainBranchOptions,
  type ActiveFilterChipDescriptor,
  type ExtraActiveFilterChip,
} from '@/lib/report/filters';
import { AnimatedChipList } from '@/components/motion';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

type RegisterActiveFilterChipsProps = {
  onClearAll?: () => void;
  /** Reload page data after a chip is removed (filters are already committed). */
  onFilterRemoved?: () => void;
  extraActiveChips?: ExtraActiveFilterChip[];
};

export function RegisterActiveFilterChips({
  onClearAll,
  onFilterRemoved,
  extraActiveChips = [],
}: RegisterActiveFilterChipsProps) {
  const {
    appliedFilters,
    selectedBranch,
    offices,
    branchesList,
    franchiseesList,
    callTypeOptions,
    stateOptions,
    cityOptions,
    technicianOptions,
    removeActiveFilterChip,
  } = useReportFilters();

  const applied = appliedFilters;
  const appliedBranch = applied?.selectedBranch ?? selectedBranch;

  const branchOptions = useMemo(
    () => buildMainBranchOptions(offices, branchesList),
    [offices, branchesList]
  );
  const franchiseeOptions = useMemo(
    () => buildFranchiseeOptions(offices, appliedBranch, franchiseesList),
    [offices, appliedBranch, franchiseesList]
  );

  const chips = useMemo(() => {
    if (!applied) return [];
    const resolveLabel = (field: ActiveFilterChipDescriptor['removeKey'], value: string) => {
      if (field === 'selectedBranch') return branchOptions.find((o) => o.value === value)?.label || value;
      if (field === 'selectedFranchisee') return franchiseeOptions.find((o) => o.value === value)?.label || value;
      if (field === 'selectedCallTypes') return callTypeOptions.find((o) => o.value === value)?.label || value;
      if (field === 'selectedState') return stateOptions.find((o) => o.value === value)?.label || value;
      if (field === 'selectedCity') return cityOptions.find((o) => o.value === value)?.label || value;
      if (field === 'selectedTechnician') return technicianOptions.find((o) => o.value === value)?.label || value;
      return value;
    };
    return buildActiveFilterChips({
      search: applied.search,
      pincodeSearch: applied.pincodeSearch,
      dateRange: applied.dateRange,
      dateFilterColumn: applied.dateFilterColumn,
      selectedStatus: applied.selectedStatus,
      selectedCallTypes: applied.selectedCallTypes,
      priorityFilter: applied.priorityFilter,
      portalFilter: applied.portalFilter,
      selectedState: applied.selectedState,
      selectedCity: applied.selectedCity,
      selectedBranch: applied.selectedBranch,
      selectedFranchisee: applied.selectedFranchisee,
      selectedTechnician: applied.selectedTechnician,
      selectedOfficeIds: applied.selectedOfficeIds,
      resolveLabel,
    });
  }, [
    applied,
    branchOptions,
    franchiseeOptions,
    callTypeOptions,
    stateOptions,
    cityOptions,
    technicianOptions,
  ]);

  const allChips = [...chips, ...extraActiveChips];
  if (!applied || allChips.length === 0) return null;

  const handleRemoveChip = (chip: ActiveFilterChipDescriptor) => {
    removeActiveFilterChip(chip);
    onFilterRemoved?.();
  };

  const handleRemoveExtraChip = (chip: ExtraActiveFilterChip) => {
    chip.onRemove();
    onFilterRemoved?.();
  };

  const handleClearAll = () => {
    onClearAll?.();
  };

  return (
    <div className="register-filter-chips">
      <AnimatedChipList>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="register-filter-chip"
            onClick={() => handleRemoveChip(chip)}
            title={`Remove ${chip.label}`}
          >
            <span className="truncate">{chip.label}</span>
            <X size={12} className="shrink-0" />
          </button>
        ))}
        {extraActiveChips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="register-filter-chip"
            onClick={() => handleRemoveExtraChip(chip)}
            title={`Remove ${chip.label}`}
          >
            <span className="truncate">{chip.label}</span>
            <X size={12} className="shrink-0" />
          </button>
        ))}
      </AnimatedChipList>
      <button type="button" className="register-filter-chip register-filter-chip--clear" onClick={handleClearAll}>
        Clear all
      </button>
    </div>
  );
}
