'use client';

import React from 'react';
import { AnimatedMetric } from '@/components/motion';

export type DashboardPipelineStats = {
  total_calls: number;
  open_calls: number;
  open_unallocated: number;
  assigned: number;
  solved_calls: number;
  tech_solved: number;
  cancelled_calls: number;
};

/** Same chrome as Call Register stats — Total / Solved / Open / Cancelled. */
export function DashboardStatsStrip({
  stats,
}: {
  stats: DashboardPipelineStats;
  reduceMotion?: boolean;
}) {
  const closed = Math.max(0, stats.solved_calls - stats.tech_solved);

  return (
    <div className="register-stats-bar">
      <div className="register-stat-item">
        <AnimatedMetric value={stats.total_calls} className="register-stat-value text-slate-900" />
        <span className="register-stat-label">Total calls</span>
      </div>

      <div className="register-stat-item register-stat-item--detailed">
        <div className="register-stat-main">
          <AnimatedMetric
            value={stats.solved_calls}
            className="register-stat-value text-emerald-600"
          />
          <span className="register-stat-label">Solved</span>
        </div>
        <div className="register-stat-breakdown">
          <span className="register-stat-sub">
            <span className="register-stat-sub-label" title="Technician solved — awaiting full closure">
              Tech. Solve Call
            </span>
            <AnimatedMetric value={stats.tech_solved} className="register-stat-sub-value" />
          </span>
          <span className="register-stat-sub">
            <span className="register-stat-sub-label" title="Fully closed calls">
              Closed
            </span>
            <AnimatedMetric value={closed} className="register-stat-sub-value" />
          </span>
        </div>
      </div>

      <div className="register-stat-item register-stat-item--detailed">
        <div className="register-stat-main">
          <AnimatedMetric value={stats.open_calls} className="register-stat-value text-blue-600" />
          <span className="register-stat-label">Open</span>
        </div>
        <div className="register-stat-breakdown">
          <span className="register-stat-sub">
            <span className="register-stat-sub-label">Open Unallocated</span>
            <AnimatedMetric value={stats.open_unallocated} className="register-stat-sub-value" />
          </span>
          <span className="register-stat-sub">
            <span className="register-stat-sub-label" title="Open calls with a technician assigned">
              Assigned
            </span>
            <AnimatedMetric value={stats.assigned} className="register-stat-sub-value" />
          </span>
        </div>
      </div>

      <div className="register-stat-item">
        <AnimatedMetric
          value={stats.cancelled_calls}
          className="register-stat-value text-rose-600"
        />
        <span className="register-stat-label">Cancelled</span>
      </div>
    </div>
  );
}
