'use client';

import React from 'react';
import { flushSync } from 'react-dom';
import { AnimatedMetric } from '@/components/motion';
import {
  REGISTER_STATUS_PRESETS,
  statusPresetMatches,
  type DraftFilterOverrides,
} from '@/modules/mis';
import type { RegisterSummary } from '@/modules/mis';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';

type RegisterStatsBarProps = {
  summary: RegisterSummary | null;
};

function statItemClass(active: boolean, detailed = false) {
  return [
    'register-stat-item',
    detailed ? 'register-stat-item--detailed' : '',
    active ? 'register-stat-item--active' : '',
    'register-stat-item--clickable',
  ]
    .filter(Boolean)
    .join(' ');
}

export function RegisterStatsBar({ summary }: RegisterStatsBarProps) {
  const { selectedStatus, setSelectedStatus, applyFilters } = useReportFilters();

  if (!summary) return null;

  const commitStatus = (next: string[]) => {
    flushSync(() => setSelectedStatus(next));
    applyFilters({ selectedStatus: next } as DraftFilterOverrides);
  };

  const togglePreset = (preset: readonly string[]) => {
    if (statusPresetMatches(selectedStatus, preset)) {
      commitStatus([]);
    } else {
      commitStatus([...preset]);
    }
  };

  const totalActive = selectedStatus.length === 0;
  const solvedActive = statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.solved);
  const openActive = statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.open);
  const cancelledActive = statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.cancelled);
  const openUnallocatedActive = statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.openUnallocated);
  const assignedActive = statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.assigned);
  const techSolvedActive = statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.techSolved);
  const closedActive = statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.closed);

  return (
    <div className="register-stats-bar">
      <button
        type="button"
        className={statItemClass(totalActive)}
        onClick={() => commitStatus([])}
        title="Show all calls in the applied date range and filters"
      >
        <AnimatedMetric value={summary.total || 0} className="register-stat-value text-slate-900" />
        <span className="register-stat-label">Total calls</span>
      </button>

      <button
        type="button"
        className={statItemClass(solvedActive, true)}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.solved)}
        title="Solved calls — includes Tech. Solve Call and Closed sub-counts"
      >
        <div className="register-stat-main">
          <AnimatedMetric value={summary.solved || 0} className="register-stat-value text-emerald-600" />
          <span className="register-stat-label">Solved</span>
        </div>
        <div className="register-stat-breakdown">
          <span
            role="button"
            tabIndex={0}
            className={`register-stat-sub ${techSolvedActive ? 'register-stat-sub--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePreset(REGISTER_STATUS_PRESETS.techSolved);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                togglePreset(REGISTER_STATUS_PRESETS.techSolved);
              }
            }}
          >
            <span className="register-stat-sub-label" title="Technician solved — fast-close without full closure">
              Tech. Solve Call
            </span>
            <AnimatedMetric value={summary.techSolved || 0} className="register-stat-sub-value" />
          </span>
          <span
            role="button"
            tabIndex={0}
            className={`register-stat-sub ${closedActive ? 'register-stat-sub--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePreset(REGISTER_STATUS_PRESETS.closed);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                togglePreset(REGISTER_STATUS_PRESETS.closed);
              }
            }}
          >
            <span className="register-stat-sub-label" title="Fully closed calls (includes rejected closures)">
              Closed
            </span>
            <AnimatedMetric value={summary.closed || 0} className="register-stat-sub-value" />
          </span>
        </div>
      </button>

      <button
        type="button"
        className={statItemClass(openActive, true)}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.open)}
        title="Open calls — includes Open Unallocated and Assigned sub-counts"
      >
        <div className="register-stat-main">
          <AnimatedMetric value={summary.open || 0} className="register-stat-value text-blue-600" />
          <span className="register-stat-label">Open</span>
        </div>
        <div className="register-stat-breakdown">
          <span
            role="button"
            tabIndex={0}
            className={`register-stat-sub ${openUnallocatedActive ? 'register-stat-sub--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePreset(REGISTER_STATUS_PRESETS.openUnallocated);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                togglePreset(REGISTER_STATUS_PRESETS.openUnallocated);
              }
            }}
          >
            <span className="register-stat-sub-label">Open Unallocated</span>
            <AnimatedMetric value={summary.openUnallocated || 0} className="register-stat-sub-value" />
          </span>
          <span
            role="button"
            tabIndex={0}
            className={`register-stat-sub ${assignedActive ? 'register-stat-sub--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePreset(REGISTER_STATUS_PRESETS.assigned);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                togglePreset(REGISTER_STATUS_PRESETS.assigned);
              }
            }}
          >
            <span className="register-stat-sub-label" title="Open calls with a technician assigned">
              Assigned
            </span>
            <AnimatedMetric value={summary.assigned || 0} className="register-stat-sub-value" />
          </span>
        </div>
      </button>

      <button
        type="button"
        className={statItemClass(cancelledActive)}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.cancelled)}
        title="Cancelled calls in the current filter scope"
      >
        <AnimatedMetric value={summary.cancelled || 0} className="register-stat-value text-rose-600" />
        <span className="register-stat-label">Cancelled</span>
      </button>
    </div>
  );
}
