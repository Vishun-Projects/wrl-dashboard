'use client';

import React, { useState } from 'react';
import { RegisterCompactToolbar } from '@/components/RegisterCompactToolbar';
import { RegisterFilterDrawer } from '@/components/RegisterFilterDrawer';
import { RegisterActiveFilterChips } from '@/components/RegisterActiveFilterChips';
import { RegisterStatsBar } from '@/components/RegisterStatsBar';
import { ReportFetchingBar } from '@/components/ReportLoadingFeedback';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import type { RegisterSummary } from '@/lib/report-search';

type RegisterPageFiltersProps = {
  onClearAll?: () => void;
  onSearchEnter?: () => void;
  onPincodeEnter?: () => void;
  /** When provided, renders clickable KPI row below chips (Call Register). */
  summary?: RegisterSummary | null;
  /** Additional loading state (e.g. Call Register table fetch). */
  loading?: boolean;
  loadingLabel?: string;
};

export function RegisterPageFilters({
  onClearAll,
  onSearchEnter,
  onPincodeEnter,
  summary,
  loading = false,
  loadingLabel,
}: RegisterPageFiltersProps) {
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const { distributionLoading, isSearchDebouncing } = useReportFilters();
  const isFetching = loading || distributionLoading || isSearchDebouncing;
  const fetchLabel =
    loadingLabel ?? (isSearchDebouncing ? 'Waiting for search…' : 'Loading calls…');

  return (
    <>
      <RegisterCompactToolbar
        onOpenFilters={() => setFilterDrawerOpen(true)}
        onSearchEnter={onSearchEnter}
        onPincodeEnter={onPincodeEnter}
      />
      <RegisterActiveFilterChips onClearAll={onClearAll} />
      <ReportFetchingBar active={isFetching} label={fetchLabel} />
      {summary !== undefined && <RegisterStatsBar summary={summary} />}
      <RegisterFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        onClear={onClearAll}
      />
    </>
  );
}
