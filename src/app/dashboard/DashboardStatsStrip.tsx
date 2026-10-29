'use client';

import React from 'react';
import { AnimatedMetric } from '@/components/motion';
import { DashboardPanel } from '@/app/dashboard/DashboardPanel';

export type DashboardPipelineStats = {
  total_calls: number;
  open_calls: number;
  open_unallocated: number;
  assigned: number;
  solved_calls: number;
  tech_solved: number;
  cancelled_calls: number;
};

function closeRatePct(solved: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((solved / total) * 1000) / 10;
}

function Metric({
  label,
  value,
  hint,
  valueClassName = 'text-slate-900 dark:text-white',
}: {
  label: string;
  value: number;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5 sm:px-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p
        className={`mt-1 text-[1.2rem] font-semibold tabular-nums tracking-tight ${valueClassName}`}
      >
        <AnimatedMetric value={value} />
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

/** Equal-weight status strip — one panel, hairline separators (no tile soup). */
export function DashboardStatsStrip({
  stats,
  reduceMotion = false,
}: {
  stats: DashboardPipelineStats;
  reduceMotion?: boolean;
}) {
  const solvedPct = closeRatePct(stats.solved_calls, stats.total_calls);

  return (
    <DashboardPanel
      title="Status"
      subtitle={`${solvedPct}% solved · open ${stats.open_calls.toLocaleString('en-IN')}`}
      reduceMotion={reduceMotion}
      bodyClassName="min-w-0"
    >
      <div className="grid grid-cols-2 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6 lg:divide-x dark:divide-slate-800">
        <Metric label="Total" value={stats.total_calls} />
        <Metric
          label="Unallocated"
          value={stats.open_unallocated}
          valueClassName={
            stats.open_unallocated > 0
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-slate-900 dark:text-white'
          }
        />
        <Metric label="Assigned" value={stats.assigned} />
        <Metric
          label="Solved"
          value={stats.solved_calls}
          valueClassName="text-emerald-700 dark:text-emerald-400"
        />
        <Metric
          label="Tech solved"
          value={stats.tech_solved}
          hint="Awaiting closure"
          valueClassName="text-amber-700 dark:text-amber-400"
        />
        <Metric
          label="Cancelled"
          value={stats.cancelled_calls}
          valueClassName="text-rose-700 dark:text-rose-400"
        />
      </div>
    </DashboardPanel>
  );
}
