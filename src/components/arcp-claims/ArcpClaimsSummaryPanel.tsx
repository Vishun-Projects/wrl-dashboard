'use client';

import React from 'react';
import { AnimatedMetric } from '@/components/motion';
import {
  ARCP_TALLY_GROUPING_OPTIONS,
  formatArcpAmountSummary,
  type ArcpTallyDetailLevel,
  type ArcpTallyGrouping,
} from '@/lib/arcp-claims/table';

export type ArcpTableViewMode = 'summary' | 'monthly' | 'both';

export type ArcpSummaryTotals = {
  serviceLineCount: number;
  travelLineCount: number;
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

type ArcpClaimsSummaryPanelProps = {
  totals: ArcpSummaryTotals;
  tableView: ArcpTableViewMode;
  onTableViewChange: (view: ArcpTableViewMode) => void;
  tallyGrouping: ArcpTallyGrouping;
  onTallyGroupingChange: (grouping: ArcpTallyGrouping) => void;
  tallyDetailLevel: ArcpTallyDetailLevel;
  onTallyDetailLevelChange: (level: ArcpTallyDetailLevel) => void;
  includeTravelReimbursement: boolean;
  onIncludeTravelChange: (value: boolean) => void;
  categorySectionCount?: number;
};

function InlinePills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-slate-200 bg-bg-soft p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={`whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
            value === opt.value
              ? 'bg-bg-canvas text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ViewControlGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {children}
    </div>
  );
}

export function ArcpClaimsSummaryPanel({
  totals,
  tableView,
  onTableViewChange,
  tallyGrouping,
  onTallyGroupingChange,
  tallyDetailLevel,
  onTallyDetailLevelChange,
  includeTravelReimbursement,
  onIncludeTravelChange,
  categorySectionCount = 0,
}: ArcpClaimsSummaryPanelProps) {
  const showTallyControls = tableView === 'summary' || tableView === 'both';

  const detailRollupLabel =
    tallyGrouping === 'category'
      ? 'Rollup'
      : tallyGrouping === 'call_type'
        ? 'Per type'
        : 'Per type';

  return (
    <div className="shrink-0 border-b border-slate-200 bg-bg-canvas">
      <div className="register-stats-bar">
        <div className="register-stat-item">
          <AnimatedMetric
            value={totals.serviceLineCount}
            className="register-stat-value text-slate-900"
          />
          <span className="register-stat-label">Service lines</span>
          {totals.travelLineCount > 0 ? (
            <span className="text-[10px] font-medium text-slate-500">
              +<AnimatedMetric value={totals.travelLineCount} /> travel
            </span>
          ) : null}
        </div>
        <div className="register-stat-item">
          <AnimatedMetric
            value={totals.amountPayable}
            format={formatArcpAmountSummary}
            snapToInteger={false}
            className="register-stat-value text-slate-900 tabular-nums"
          />
          <span className="register-stat-label">Amount payable</span>
        </div>
        <div className="register-stat-item">
          <AnimatedMetric
            value={totals.branchApproved}
            format={formatArcpAmountSummary}
            snapToInteger={false}
            className="register-stat-value text-emerald-600 tabular-nums"
          />
          <span className="register-stat-label">Branch approved</span>
        </div>
        <div className="register-stat-item">
          <AnimatedMetric
            value={totals.hoApproved}
            format={formatArcpAmountSummary}
            snapToInteger={false}
            className="register-stat-value text-blue-600 tabular-nums"
          />
          <span className="register-stat-label">HO approved</span>
        </div>
      </div>

      <div className="flex items-center gap-3 overflow-x-auto border-t border-slate-100 px-3 py-1.5">
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={includeTravelReimbursement}
            onChange={(e) => onIncludeTravelChange(e.target.checked)}
            className="h-3 w-3 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          Travel
        </label>

        <ViewControlGroup label="Layout">
          <InlinePills<ArcpTableViewMode>
            value={tableView}
            onChange={onTableViewChange}
            options={[
              { value: 'summary', label: 'Tally', title: 'Service tally table' },
              { value: 'monthly', label: 'Monthly', title: 'Totals by month' },
              { value: 'both', label: 'Both', title: 'Tally and monthly' },
            ]}
          />
        </ViewControlGroup>

        {showTallyControls ? (
          <>
            <ViewControlGroup label="Group by">
              <InlinePills<ArcpTallyGrouping>
                value={tallyGrouping}
                onChange={onTallyGroupingChange}
                options={ARCP_TALLY_GROUPING_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label:
                    opt.value === 'category'
                      ? 'Category'
                      : opt.value === 'call_type'
                        ? 'Call type'
                        : 'Type + M/M',
                  title: opt.title,
                }))}
              />
            </ViewControlGroup>

            <ViewControlGroup label="Rows">
              <InlinePills<ArcpTallyDetailLevel>
                value={tallyDetailLevel}
                onChange={onTallyDetailLevelChange}
                options={[
                  {
                    value: 'full',
                    label: 'Full',
                    title: 'Every row for the selected grouping',
                  },
                  {
                    value: 'category',
                    label: detailRollupLabel,
                    title:
                      tallyGrouping === 'category'
                        ? `One total per category (${categorySectionCount})`
                        : 'One total per call-type section',
                  },
                  {
                    value: 'totals',
                    label: 'Total only',
                    title: 'Grand total row only',
                  },
                ]}
              />
            </ViewControlGroup>
          </>
        ) : null}
      </div>
    </div>
  );
}
