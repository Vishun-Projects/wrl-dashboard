'use client';

import React from 'react';
import { AnimatedMetric } from '@/components/motion';
import type { WarrantyMasterSummary } from '@/modules/warranty/services';

type WarrantyMasterSummaryPanelProps = {
  summary: WarrantyMasterSummary;
  catalogMachineTotal: number;
  rowCount: number;
  isFiltered: boolean;
  isStale: boolean;
};

function formatPct(part: number, whole: number): string | null {
  if (whole <= 0 || part >= whole) return null;
  const pct = Math.round((part / whole) * 1000) / 10;
  return `${pct}% of catalog`;
}

export function WarrantyMasterSummaryPanel({
  summary,
  catalogMachineTotal,
  rowCount,
  isFiltered,
  isStale,
}: WarrantyMasterSummaryPanelProps) {
  const machineShare = formatPct(summary.totalMachines, catalogMachineTotal);

  return (
    <div className="shrink-0 border-b border-slate-200 bg-bg-canvas">
      <div
        className={`register-stats-bar warranty-master-stats-bar transition-opacity duration-300 ease-out ${
          isStale ? 'opacity-70' : 'opacity-100'
        }`}
      >
        <div className="register-stat-item">
          <AnimatedMetric
            value={summary.totalMachines}
            className="register-stat-value text-slate-900 tabular-nums"
          />
          <span className="register-stat-label">Machines in view</span>
          {machineShare ? (
            <span className="text-[10px] font-medium text-slate-500">{machineShare}</span>
          ) : null}
        </div>
        <div className="register-stat-item">
          <AnimatedMetric
            value={summary.distinctCustomers}
            className="register-stat-value text-blue-600 tabular-nums"
          />
          <span className="register-stat-label">Customers</span>
        </div>
        <div className="register-stat-item">
          <AnimatedMetric
            value={summary.distinctGroups}
            className="register-stat-value text-emerald-600 tabular-nums"
          />
          <span className="register-stat-label">Product groups</span>
        </div>
        <div className="register-stat-item">
          <AnimatedMetric
            value={rowCount}
            className="register-stat-value text-violet-600 tabular-nums"
          />
          <span className="register-stat-label">Table rows</span>
          {isFiltered ? (
            <span className="text-[10px] font-medium text-violet-600/80">Filtered</span>
          ) : null}
        </div>
      </div>
      {isStale ? (
        <p className="border-t border-slate-100 px-3 py-1 text-[10px] text-slate-400" aria-live="polite">
          Updating table…
        </p>
      ) : null}
    </div>
  );
}
