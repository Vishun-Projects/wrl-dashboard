'use client';

import React, { useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { RegisterMultiSelect } from '@/components/RegisterMultiSelect';
import {
  buildFranchiseeOptions,
  buildMainBranchOptions,
  type DraftFilterOverrides,
} from '@/lib/report-filters';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

type RegisterBranchFranchiseeFiltersProps = {
  applyMode?: 'instant' | 'confirm';
  commitOnChange?: boolean;
};

export function RegisterBranchFranchiseeFilters({
  applyMode = 'confirm',
  commitOnChange = false,
}: RegisterBranchFranchiseeFiltersProps) {
  const {
    applyFilters,
    offices,
    branchesList,
    franchiseesList,
    selectedBranch,
    handleBranchesChange,
    selectedFranchisee,
    setSelectedFranchisee,
  } = useReportFilters();

  const wrapCommit = useCallback(
    (setter: (values: string[]) => void, field: keyof Pick<DraftFilterOverrides, 'selectedFranchisee'>) => {
      if (!commitOnChange) return setter;
      return (values: string[]) => {
        flushSync(() => setter(values));
        applyFilters({ [field]: values } as DraftFilterOverrides);
      };
    },
    [commitOnChange, applyFilters]
  );

  const onBranchChange = commitOnChange
    ? (values: string[]) => {
        flushSync(() => handleBranchesChange(values));
        applyFilters();
      }
    : handleBranchesChange;
  const onFranchiseeChange = wrapCommit(setSelectedFranchisee, 'selectedFranchisee');

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
        onChange={onBranchChange}
        searchable
        panelClassName="w-64"
        applyMode={applyMode}
      />
      <RegisterMultiSelect
        label="Franchisee"
        emptyLabel="All Franchisees"
        options={franchiseeOptions}
        selected={selectedFranchisee}
        onChange={onFranchiseeChange}
        searchable
        panelClassName="w-64"
        applyMode={applyMode}
      />
    </>
  );
}
