'use client';

import React, { useState } from 'react';
import { RegisterCompactToolbar } from '@/modules/mis/register/components/RegisterCompactToolbar';
import { RegisterFilterDrawer } from '@/modules/mis/register/components/RegisterFilterDrawer';
import { RegisterActiveFilterChips } from '@/modules/mis/register/components/RegisterActiveFilterChips';
import { RegisterStatsBar } from '@/modules/mis/register/components/RegisterStatsBar';
import { ReportFetchingBar } from '@/modules/mis/components/ReportLoadingFeedback';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';
import type { RegisterSummary } from '@/modules/mis';
import type { ExtraActiveFilterChip } from '@/modules/mis';

type RegisterPageFiltersProps = {
  onClearAll?: () => void;
  onSearchEnter?: () => void;
  onPincodeEnter?: () => void;
  /** Runs when an applied filter chip is removed. */
  onFilterRemoved?: () => void;
  onBeforeOpenFilters?: () => void;
  /** True when refetching with prior data visible (stale-while-revalidate). */
  updating?: boolean;
  updatingLabel?: string;
  /** When provided, renders clickable KPI row below chips (Call Register). */
  summary?: RegisterSummary | null;
  /** Rendered below shared filter fields in the drawer (Serial Audit complaint picker). */
  drawerExtra?: React.ReactNode;
  /** Additional chips after shared report filter chips. */
  extraActiveChips?: ExtraActiveFilterChip[];
  /** Added to Filters badge count in toolbar and drawer. */
  extraFilterCount?: number;
};

export function RegisterPageFilters({
  onClearAll,
  onSearchEnter,
  onPincodeEnter,
  onFilterRemoved,
  onBeforeOpenFilters,
  updating = false,
  updatingLabel,
  summary,
  drawerExtra,
  extraActiveChips,
  extraFilterCount = 0,
}: RegisterPageFiltersProps) {
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const { clearAllFilters, flushSearchDebounce } = useReportFilters();

  const handleSearchEnter = () => {
    flushSearchDebounce();
    onSearchEnter?.();
  };

  const handlePincodeEnter = () => {
    flushSearchDebounce();
    onPincodeEnter?.();
  };

  const fetchLabel = updatingLabel ?? 'Updating…';

  const handleClearAll = () => {
    clearAllFilters();
    onClearAll?.();
  };

  return (
    <>
      <RegisterCompactToolbar
        onOpenFilters={() => {
          onBeforeOpenFilters?.();
          setFilterDrawerOpen(true);
        }}
        onSearchEnter={onSearchEnter ? handleSearchEnter : undefined}
        onPincodeEnter={onPincodeEnter ? handlePincodeEnter : undefined}
        extraFilterCount={extraFilterCount}
      />
      <RegisterActiveFilterChips
        onClearAll={handleClearAll}
        onFilterRemoved={onFilterRemoved}
        extraActiveChips={extraActiveChips}
      />
      <ReportFetchingBar active={updating} label={fetchLabel} />
      {summary !== undefined && <RegisterStatsBar summary={summary} />}
      <RegisterFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        onClear={handleClearAll}
        drawerExtra={drawerExtra}
        extraFilterCount={extraFilterCount}
      />
    </>
  );
}
