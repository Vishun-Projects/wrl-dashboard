'use client';

import React, { useState } from 'react';
import { RegisterCompactToolbar } from '@/features/register/components/RegisterCompactToolbar';
import { RegisterFilterDrawer } from '@/features/register/components/RegisterFilterDrawer';
import { RegisterActiveFilterChips } from '@/features/register/components/RegisterActiveFilterChips';
import { RegisterStatsBar } from '@/features/register/components/RegisterStatsBar';
import { ReportFetchingBar } from '@/features/report/components/ReportLoadingFeedback';
import { useReportFilters } from '@/features/report/components/ReportFiltersContext';
import type { RegisterSummary } from '@/features/report';
import type { ExtraActiveFilterChip } from '@/features/report';

type RegisterPageFiltersProps = {
  onClearAll?: () => void;
  onSearchEnter?: () => void;
  onPincodeEnter?: () => void;
  /** Runs after context {@link applyFilters} from the toolbar Apply / Run button. */
  onApply?: () => void;
  /** Runs after drawer Apply commits filters. Defaults to {@link onApply}. */
  onDrawerApply?: () => void;
  /** Runs when an applied filter chip is removed. Defaults to {@link onApply} when set. */
  onFilterRemoved?: () => void;
  /** When false, Clear all does not invoke {@link onApply}. Default true. */
  reloadOnClearAll?: boolean;
  onBeforeOpenFilters?: () => void;
  applyDisabled?: boolean;
  applyLabel?: string;
  /** When provided, renders clickable KPI row below chips (Call Register). */
  summary?: RegisterSummary | null;
  /** True when refetching with prior data visible (stale-while-revalidate). */
  updating?: boolean;
  updatingLabel?: string;
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
  onApply,
  onDrawerApply,
  onFilterRemoved,
  reloadOnClearAll = true,
  onBeforeOpenFilters,
  applyDisabled = false,
  applyLabel,
  summary,
  updating = false,
  updatingLabel,
  drawerExtra,
  extraActiveChips,
  extraFilterCount = 0,
}: RegisterPageFiltersProps) {
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const { applyFilters, clearAllFilters, resourcesLoaded } = useReportFilters();

  const handleApplyFromToolbar = () => {
    applyFilters();
    onApply?.();
  };

  const handleSearchEnter = () => {
    applyFilters();
    onSearchEnter?.();
  };

  const handlePincodeEnter = () => {
    applyFilters();
    onPincodeEnter?.();
  };

  const fetchLabel = updatingLabel ?? 'Updating…';

  const handleClearAll = () => {
    clearAllFilters();
    onClearAll?.();
    if (reloadOnClearAll) onApply?.();
  };

  const handleFilterRemoved = onFilterRemoved ?? (onApply ? () => onApply() : undefined);
  const handleDrawerApply = onDrawerApply ?? onApply;

  return (
    <>
      <RegisterCompactToolbar
        onOpenFilters={() => {
          onBeforeOpenFilters?.();
          setFilterDrawerOpen(true);
        }}
        onSearchEnter={onSearchEnter ? handleSearchEnter : undefined}
        onPincodeEnter={onPincodeEnter ? handlePincodeEnter : undefined}
        onApply={onApply ? handleApplyFromToolbar : undefined}
        applyDisabled={applyDisabled || !resourcesLoaded}
        applyLabel={applyLabel}
        extraFilterCount={extraFilterCount}
      />
      <RegisterActiveFilterChips
        onClearAll={handleClearAll}
        onFilterRemoved={handleFilterRemoved}
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
        onApply={
          handleDrawerApply
            ? () => {
                applyFilters();
                handleDrawerApply();
                setFilterDrawerOpen(false);
              }
            : undefined
        }
        applyDisabled={applyDisabled || !resourcesLoaded}
      />
    </>
  );
}
