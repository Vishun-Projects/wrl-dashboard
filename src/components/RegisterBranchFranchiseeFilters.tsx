'use client';

import React, { useMemo } from 'react';
import { RegisterMultiSelect } from '@/components/RegisterMultiSelect';
import { buildFranchiseeOptions, buildMainBranchOptions } from '@/lib/report-filters';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

export function RegisterBranchFranchiseeFilters() {
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

  return (
    <>
      <RegisterMultiSelect
        label="Main Branch"
        emptyLabel="All Branches"
        options={branchOptions}
        selected={selectedBranch}
        onChange={handleBranchesChange}
        searchable
        panelClassName="w-64"
      />
      <RegisterMultiSelect
        label="Franchisee"
        emptyLabel="All Franchisees"
        options={franchiseeOptions}
        selected={selectedFranchisee}
        onChange={setSelectedFranchisee}
        searchable
        panelClassName="w-64"
      />
    </>
  );
}
