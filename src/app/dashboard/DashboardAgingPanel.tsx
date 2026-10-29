'use client';

import React from 'react';
import { Ban, CheckCircle2, CircleDashed, Hourglass } from 'lucide-react';
import { AnimatedMetric } from '@/components/motion';
import { DashboardPanel } from '@/app/dashboard/DashboardPanel';

export type DashboardAgingStats = {
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
};

type AgingRow = {
  key: string;
  label: string;
  value: number;
  icon: typeof CheckCircle2;
  warn?: boolean;
};

/** Compact open-aging list in one panel (replaces five loose cards). */
export function DashboardAgingPanel({
  stats,
  reduceMotion = false,
}: {
  stats: DashboardAgingStats;
  reduceMotion?: boolean;
}) {
  const over7 = stats.age_7 + stats.age_15;
  const rows: AgingRow[] = [
    { key: 'a2', label: 'Open ≤2 days', value: stats.age_2, icon: CheckCircle2 },
    { key: 'a3', label: 'Open 3–7 days', value: stats.age_3, icon: CircleDashed },
    { key: 'a7', label: 'Open 8–15 days', value: stats.age_7, icon: Hourglass, warn: true },
    { key: 'a15', label: 'Open >15 days', value: stats.age_15, icon: Ban, warn: true },
    { key: 'over7', label: 'Aging >7 days', value: over7, icon: Hourglass, warn: true },
  ];

  return (
    <DashboardPanel
      title="Open aging"
      subtitle={`${over7.toLocaleString('en-IN')} over 7d`}
      reduceMotion={reduceMotion}
      bodyClassName="min-w-0"
    >
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => (
          <li
            key={row.key}
            className={`flex items-center gap-2.5 px-4 py-2.5 ${
              row.warn && row.value > 0 ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
            }`}
          >
            <row.icon
              size={14}
              className={row.warn && row.value > 0 ? 'text-amber-600' : 'text-slate-400'}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600 dark:text-slate-300">
              {row.label}
            </span>
            <span
              className={`text-[1.05rem] font-semibold tabular-nums tracking-tight ${
                row.warn && row.value > 0
                  ? 'text-amber-800 dark:text-amber-300'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              <AnimatedMetric value={row.value} />
            </span>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}
