'use client';

import React, { useMemo } from 'react';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { RegisterBranchFranchiseeFilters } from '@/modules/mis/register/components/RegisterBranchFranchiseeFilters';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { ReportProgressBar } from '@/modules/mis/components';
import {
  ARCP_DATE_FILTER_OPTIONS,
  type ArcpDateFilterColumn,
} from '@/sql/arcp-claims/query';
import type { ReportDateRange } from '@/modules/mis';
import type { ArcpLoadStatus } from '@/modules/arcp-claims/components/ArcpClaimsLoadBanner';

type ArcpClaimsToolbarProps = {
  arcpDateFilterColumn: ArcpDateFilterColumn;
  onDateFilterColumnChange: (column: ArcpDateFilterColumn) => void;
  dateRange: ReportDateRange;
  onDateRangeChange: (range: ReportDateRange) => void;
  callTypeOptions: Array<{ value: string; label: string }>;
  selectedCallTypes: string[];
  onCallTypesChange: (values: string[]) => void;
  loading: boolean;
  loadStatus: ArcpLoadStatus | null;
  loadProgressLabel: string;
};

export function ArcpClaimsToolbar({
  arcpDateFilterColumn,
  onDateFilterColumnChange,
  dateRange,
  onDateRangeChange,
  callTypeOptions,
  selectedCallTypes,
  onCallTypesChange,
  loading,
  loadStatus,
  loadProgressLabel,
}: ArcpClaimsToolbarProps) {
  const dateBasisOptions = useMemo(
    () => ARCP_DATE_FILTER_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label })),
    []
  );

  return (
    <div className="relative z-20 border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
      <div className="report-toolbar-filters-row arcp-claims-toolbar-row">
        <FilterSelect
          label="Date basis"
          emptyLabel="Date basis"
          mode="single"
          options={dateBasisOptions}
          selected={[arcpDateFilterColumn]}
          onChange={(values) => {
            const next = values[0] as ArcpDateFilterColumn | undefined;
            if (next) onDateFilterColumnChange(next);
          }}
          layout="inline"
          panelClassName="w-64"
        />

        <div className="report-toolbar-filters-date shrink-0">
          <DateRangeSelector
            value={dateRange.label}
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={onDateRangeChange}
          />
        </div>

        <RegisterBranchFranchiseeFilters layout="inline" />

        <FilterSelect
          label="Call Type"
          emptyLabel="All Call Types"
          options={callTypeOptions}
          selected={selectedCallTypes}
          onChange={onCallTypesChange}
          layout="inline"
          panelClassName="w-64"
        />

        <div className="ml-auto flex shrink-0 items-center gap-2 pl-1">
          {loading && loadStatus ? (
            <ReportProgressBar
              done={loadStatus.done}
              total={loadStatus.total}
              percent={loadStatus.percent}
              label={`${loadStatus.done}/${loadStatus.total} ${loadProgressLabel}${
                loadStatus.failedCount ? ` · ${loadStatus.failedCount} timed out` : ''
              }`}
              etaLabel={loadStatus.etaRemainingLabel}
              className="hidden min-w-[12rem] lg:flex"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
