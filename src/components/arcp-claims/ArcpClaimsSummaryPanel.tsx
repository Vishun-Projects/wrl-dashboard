'use client';

import React from 'react';
import {
  formatArcpAmountSummary,
  type ArcpTallyDetailLevel,
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
  tallyDetailLevel: ArcpTallyDetailLevel;
  onTallyDetailLevelChange: (level: ArcpTallyDetailLevel) => void;
  includeTravelReimbursement: boolean;
  onIncludeTravelChange: (value: boolean) => void;
  categorySectionCount?: number;
};

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div
        className="flex flex-wrap items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5"
        role="group"
        aria-label={label}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              value === opt.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ArcpClaimsSummaryPanel({
  totals,
  tableView,
  onTableViewChange,
  tallyDetailLevel,
  onTallyDetailLevelChange,
  includeTravelReimbursement,
  onIncludeTravelChange,
  categorySectionCount = 0,
}: ArcpClaimsSummaryPanelProps) {
  const showTallyControls = tableView === 'summary' || tableView === 'both';

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Service lines</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
            {totals.serviceLineCount.toLocaleString('en-IN')}
          </p>
          {totals.travelLineCount > 0 ? (
            <p className="text-[10px] text-slate-500">
              +{totals.travelLineCount.toLocaleString('en-IN')} travel
            </p>
          ) : null}
        </div>
        <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Amount payable</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
            {formatArcpAmountSummary(totals.amountPayable)}
          </p>
        </div>
        <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Branch approved</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
            {formatArcpAmountSummary(totals.branchApproved)}
          </p>
        </div>
        <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">HO approved</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
            {formatArcpAmountSummary(totals.hoApproved)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 border-t border-slate-100 pt-2">
        <label className="inline-flex cursor-pointer items-center gap-2 self-center text-[11px] text-slate-700">
          <input
            type="checkbox"
            checked={includeTravelReimbursement}
            onChange={(e) => onIncludeTravelChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          Include travel reimbursement
        </label>

        <SegmentedControl<ArcpTableViewMode>
          label="Report layout"
          value={tableView}
          onChange={onTableViewChange}
          options={[
            { value: 'summary', label: 'Service tally', title: 'Service lines by category' },
            { value: 'monthly', label: 'Monthly', title: 'Totals by calendar month' },
            { value: 'both', label: 'Both', title: 'Tally and monthly together' },
          ]}
        />

        {showTallyControls ? (
          <SegmentedControl<ArcpTallyDetailLevel>
            label="Tally detail"
            value={tallyDetailLevel}
            onChange={onTallyDetailLevelChange}
            options={[
              {
                value: 'full',
                label: 'Full breakdown',
                title: 'Every category with Local/Upcountry and Major/Minor rows',
              },
              {
                value: 'category',
                label: 'By category',
                title: `One total row per service category (${categorySectionCount} categories)`,
              },
              {
                value: 'totals',
                label: 'Grand total',
                title: 'Only the bottom total row — no category lines',
              },
            ]}
          />
        ) : null}

        <span className="pb-1 text-[10px] text-slate-400">
          View options apply instantly. View PDF exports exactly what you see here.
        </span>
      </div>
    </div>
  );
}
