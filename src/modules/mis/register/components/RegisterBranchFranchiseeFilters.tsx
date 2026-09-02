'use client';

import React, { useMemo } from 'react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { buildFranchiseeOptions, buildMainBranchOptions } from '@/modules/mis';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';

type RegisterBranchFranchiseeFiltersProps = {
  layout?: 'block' | 'inline';
};

export function RegisterBranchFranchiseeFilters({
  layout = 'block',
}: RegisterBranchFranchiseeFiltersProps) {
  const {
    offices,
    branchesList,
    franchiseesList,
    selectedBranch,
    handleBranchesChange,
    selectedFranchisee,
    setSelectedFranchisee,
  } = useReportFilters();

  const branchOptions = useMemo(
    () => buildMainBranchOptions(offices, branchesList),
    [offices, branchesList]
  );

  const franchiseeOptions = useMemo(
    () => buildFranchiseeOptions(offices, selectedBranch, franchiseesList),
    [offices, selectedBranch, franchiseesList]
  );

  const selects = (
    <>
      <FilterSelect
        label="Main Branch"
        emptyLabel="All Branches"
        options={branchOptions}
        selected={selectedBranch}
        onChange={handleBranchesChange}
        panelClassName="w-64"
        layout={layout}
      />
      <FilterSelect
        label="Franchisee"
        emptyLabel="All Franchisees"
        options={franchiseeOptions}
        selected={selectedFranchisee}
        onChange={setSelectedFranchisee}
        panelClassName="w-64"
        layout={layout}
      />
    </>
  );

  if (layout === 'inline') {
    return <div className="report-toolbar-filters-group">{selects}</div>;
  }

  return selects;
}
