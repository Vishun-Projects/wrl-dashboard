'use client';

import React, { useState } from 'react';
import { RegisterCompactToolbar } from '@/components/RegisterCompactToolbar';
import { RegisterFilterDrawer } from '@/components/RegisterFilterDrawer';
import { RegisterActiveFilterChips } from '@/components/RegisterActiveFilterChips';
import { RegisterStatsBar } from '@/components/RegisterStatsBar';
import { ReportFetchingBar } from '@/components/ReportLoadingFeedback';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import { RestoredViewBanner } from '@/components/RestoredViewBanner';
import type { RegisterSummary } from '@/lib/report-search';
import type { ExtraActiveFilterChip } from '@/lib/report-filters';

type RegisterPageFiltersProps = {
  onClearAll?: () => void;
  onSearchEnter?: () => void;
  onPincodeEnter?: () => void;
  /** Runs after context {@link applyFilters}; page should load data for the new applied snapshot. */
  onApply?: () => void;
  applyDisabled?: boolean;
  applyLabel?: string;
  /** When provided, renders clickable KPI row below chips (Call Register). */
  summary?: RegisterSummary | null;
  /** Additional loading state (e.g. Call Register table fetch). */
  loading?: boolean;
  loadingLabel?: string;
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
  applyDisabled = false,
  applyLabel,
  summary,
  loading = false,
  loadingLabel,
  drawerExtra,
  extraActiveChips,
  extraFilterCount = 0,
}: RegisterPageFiltersProps) {
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const { applyFilters, clearAllFilters, distributionLoading, resourcesLoaded } = useReportFilters();
  const isFetching = loading || distributionLoading;

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

  const fetchLabel = loadingLabel ?? 'Loading…';

  const handleClearAll = () => {
    clearAllFilters();
    onClearAll?.();
    onApply?.();
  };

  return (
    <>
      <RegisterCompactToolbar
        onOpenFilters={() => setFilterDrawerOpen(true)}
        onSearchEnter={onSearchEnter ? handleSearchEnter : undefined}
        onPincodeEnter={onPincodeEnter ? handlePincodeEnter : undefined}
        onApply={onApply ? handleApplyFromToolbar : undefined}
        applyDisabled={applyDisabled || !resourcesLoaded}
        applyLabel={applyLabel}
        extraFilterCount={extraFilterCount}
      />
      <RestoredViewBanner />
      <RegisterActiveFilterChips
        onClearAll={handleClearAll}
        onFilterRemoved={onApply ? () => onApply() : undefined}
        extraActiveChips={extraActiveChips}
      />
      <ReportFetchingBar active={isFetching} label={fetchLabel} />
      {summary !== undefined && <RegisterStatsBar summary={summary} />}
      <RegisterFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        onClear={handleClearAll}
        drawerExtra={drawerExtra}
        extraFilterCount={extraFilterCount}
        onApply={
          onApply
            ? () => {
                applyFilters();
                onApply();
                setFilterDrawerOpen(false);
              }
            : undefined
        }
        applyDisabled={applyDisabled || !resourcesLoaded}
      />
    </>
  );
}
