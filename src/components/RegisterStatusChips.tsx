'use client';

import React from 'react';
import {
  REGISTER_STATUS_OPTIONS,
  REGISTER_STATUS_PRESETS,
  statusPresetMatches,
} from '@/lib/report-filters';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

export function RegisterStatusChips() {
  const { selectedStatus, setSelectedStatus } = useReportFilters();

  const togglePreset = (preset: readonly string[]) => {
    if (statusPresetMatches(selectedStatus, preset)) {
      setSelectedStatus([]);
    } else {
      setSelectedStatus([...preset]);
    }
  };

  const toggleSingle = (value: string) => {
    if (selectedStatus.length === 1 && selectedStatus[0] === value) {
      setSelectedStatus([]);
    } else {
      setSelectedStatus([value]);
    }
  };

  const chipClass = (active: boolean) =>
    `register-status-chip ${active ? 'register-status-chip--active' : ''}`.trim();

  return (
    <div className="register-status-chips">
      {REGISTER_STATUS_OPTIONS.map((option) => {
        const active =
          selectedStatus.length === 1
            ? selectedStatus[0] === option.value
            : statusPresetMatches(selectedStatus, [option.value]);
        return (
          <button
            key={option.value}
            type="button"
            className={chipClass(active)}
            onClick={() => toggleSingle(option.value)}
          >
            {option.label}
          </button>
        );
      })}
      <button
        type="button"
        className={chipClass(statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.open))}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.open)}
      >
        All Open
      </button>
      <button
        type="button"
        className={chipClass(statusPresetMatches(selectedStatus, REGISTER_STATUS_PRESETS.solved))}
        onClick={() => togglePreset(REGISTER_STATUS_PRESETS.solved)}
      >
        All Solved
      </button>
    </div>
  );
}
