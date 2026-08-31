'use client';

import React from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import type { AthenaReconciliationSummary } from '../types';

interface AthenaTrendAndBreakdownProps {
  summary: AthenaReconciliationSummary;
  onSelectReason?: (reason: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function AthenaTrendAndBreakdown({
  summary,
  isCollapsed = false,
  onToggleCollapse,
}: AthenaTrendAndBreakdownProps) {
  if (!isCollapsed) return null;

  const rate = summary.kpis.registrationRatePct;

  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
        <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span>Visual Analytics & Insights (Collapsed)</span>
        <span className="rounded-full bg-teal-50 px-1.5 py-0.2 text-[9px] font-bold text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
          {rate}% Recovered
        </span>
      </div>
      <button
        type="button"
        onClick={onToggleCollapse}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        <span>Expand Analytics</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
