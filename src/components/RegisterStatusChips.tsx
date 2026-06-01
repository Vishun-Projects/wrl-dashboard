'use client';

import React from 'react';
import { flushSync } from 'react-dom';
import {
  REGISTER_STATUS_OPTIONS,
  REGISTER_STATUS_PRESETS,
  statusPresetMatches,
  type DraftFilterOverrides,
} from '@/lib/report-filters';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

export function RegisterStatusChips({ commitOnChange = false }: { commitOnChange?: boolean }) {
  const { selectedStatus, setSelectedStatus, applyFilters } = useReportFilters();

  const commitStatus = (next: string[]) => {
    if (commitOnChange) {
      flushSync(() => setSelectedStatus(next));
      applyFilters({ selectedStatus: next } as DraftFilterOverrides);
    } else {
      setSelectedStatus(next);
    }
  };

  const togglePreset = (preset: readonly string[]) => {
    if (statusPresetMatches(selectedStatus, preset)) {
      commitStatus([]);
    } else {
      commitStatus([...preset]);
    }
  };

  const toggleSingle = (value: string) => {
    if (selectedStatus.length === 1 && selectedStatus[0] === value) {
      commitStatus([]);
    } else {
      commitStatus([value]);
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
