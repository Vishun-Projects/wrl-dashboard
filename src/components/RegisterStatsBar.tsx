'use client';

import React from 'react';
import {
  REGISTER_STATUS_PRESETS,
  statusPresetMatches,
} from '@/lib/report-filters';
import type { RegisterSummary } from '@/lib/report-search';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

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
  const { selectedStatus, setSelectedStatus } = useReportFilters();

  if (!summary) return null;

  const togglePreset = (preset: readonly string[]) => {
    if (statusPresetMatches(selectedStatus, preset)) {
      setSelectedStatus([]);
    } else {
      setSelectedStatus([...preset]);
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
        onClick={() => setSelectedStatus([])}
        title="Show all calls"
      >
        <span className="register-stat-value text-slate-900">{(summary.total || 0).toLocaleString()}</span>
        <span className="register-stat-label">Total calls</span>
      </button>

      <button
        type="button"
        className={statItemClass(solvedActive, true)}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.solved)}
        title="Filter solved calls"
      >
        <div className="register-stat-main">
          <span className="register-stat-value text-emerald-600">{(summary.solved || 0).toLocaleString()}</span>
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
            <span className="register-stat-sub-label">Tech. Solve Call</span>
            <span className="register-stat-sub-value">{(summary.techSolved || 0).toLocaleString()}</span>
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
            <span className="register-stat-sub-label">Closed</span>
            <span className="register-stat-sub-value">{(summary.closed || 0).toLocaleString()}</span>
          </span>
        </div>
      </button>

      <button
        type="button"
        className={statItemClass(openActive, true)}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.open)}
        title="Filter open calls"
      >
        <div className="register-stat-main">
          <span className="register-stat-value text-blue-600">{(summary.open || 0).toLocaleString()}</span>
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
            <span className="register-stat-sub-value">{(summary.openUnallocated || 0).toLocaleString()}</span>
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
            <span className="register-stat-sub-label">Assigned</span>
            <span className="register-stat-sub-value">{(summary.assigned || 0).toLocaleString()}</span>
          </span>
        </div>
      </button>

      <button
        type="button"
        className={statItemClass(cancelledActive)}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.cancelled)}
        title="Filter cancelled calls"
      >
        <span className="register-stat-value text-rose-600">{(summary.cancelled || 0).toLocaleString()}</span>
        <span className="register-stat-label">Cancelled</span>
      </button>
    </div>
  );
}
