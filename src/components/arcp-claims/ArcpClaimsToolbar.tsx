'use client';

import React from 'react';
import { Filter, Loader2 } from 'lucide-react';
import { DateRangeSelector } from '@/components/register/DateRangeSelector';
import { RegisterBranchFranchiseeFilters } from '@/components/register/RegisterBranchFranchiseeFilters';
import { RegisterMultiSelect } from '@/components/register/RegisterMultiSelect';
import { ReportProgressBar } from '@/components/report/ReportLoadingFeedback';
import {
  ARCP_DATE_FILTER_OPTIONS,
  type ArcpDateFilterColumn,
} from '@/lib/arcp-claims/query';
import type { ReportDateRange } from '@/lib/report/filters';
import type { ArcpLoadStatus } from '@/components/arcp-claims/ArcpClaimsLoadBanner';

const DATE_BASIS_SHORT: Record<ArcpDateFilterColumn, string> = {
  dcalllogdatetime: 'Call',
  dsolveddatetime: 'Solved',
  bm_approved_at: 'BM appr.',
};

type ArcpClaimsToolbarProps = {
  arcpDateFilterColumn: ArcpDateFilterColumn;
  onDateFilterColumnChange: (column: ArcpDateFilterColumn) => void;
  dateRange: ReportDateRange;
  onDateRangeChange: (range: ReportDateRange) => void;
  callTypeOptions: Array<{ value: string; label: string }>;
  selectedCallTypes: string[];
  onCallTypesChange: (values: string[]) => void;
  onApply: () => void;
  applyDisabled: boolean;
  hasPendingFilterChanges: boolean;
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
  onApply,
  applyDisabled,
  hasPendingFilterChanges,
  loading,
  loadStatus,
  loadProgressLabel,
}: ArcpClaimsToolbarProps) {
  return (
    <div className="relative z-20 border-b border-slate-200 bg-white px-3 py-1.5">
      <div className="report-toolbar-filters-row arcp-claims-toolbar-row">
        <div
          className="arcp-date-basis-control shrink-0"
          role="group"
          aria-label="Date basis"
          title="Date basis for filtering claims"
        >
          {ARCP_DATE_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.label}
              onClick={() => onDateFilterColumnChange(option.value)}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                arcpDateFilterColumn === option.value
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {DATE_BASIS_SHORT[option.value]}
            </button>
          ))}
        </div>

        <div className="report-toolbar-filters-date shrink-0">
          <DateRangeSelector
            value={dateRange.label}
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={onDateRangeChange}
          />
        </div>

        <RegisterBranchFranchiseeFilters applyMode="confirm" layout="inline" />

        <RegisterMultiSelect
          label="Call Type"
          emptyLabel="All Call Types"
          options={callTypeOptions}
          selected={selectedCallTypes}
          onChange={onCallTypesChange}
          applyMode="confirm"
          layout="inline"
          searchable
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
          <button
            type="button"
            onClick={onApply}
            disabled={applyDisabled}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium shadow-sm disabled:opacity-50 ${
              hasPendingFilterChanges
                ? 'border border-slate-800 bg-slate-900 text-white hover:bg-slate-800'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Filter className="h-3.5 w-3.5" />
            )}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
