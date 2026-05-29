'use client';

import React from 'react';
import { FilterX, X } from 'lucide-react';

export type DistributionFilterChip = {
  id: string;
  label: string;
  detail?: string;
  tone?: 'teal' | 'amber' | 'slate' | 'violet';
  onClear: () => void;
};

const toneClass: Record<NonNullable<DistributionFilterChip['tone']>, string> = {
  teal: 'distribution-filter-chip--teal',
  amber: 'distribution-filter-chip--amber',
  slate: 'distribution-filter-chip--slate',
  violet: 'distribution-filter-chip--violet',
};

type DistributionActiveFiltersProps = {
  chips: DistributionFilterChip[];
  onClearTableLink?: () => void;
  tableLinkActive?: boolean;
};

export function DistributionActiveFilters({
  chips,
  onClearTableLink,
  tableLinkActive = false,
}: DistributionActiveFiltersProps) {
  if (chips.length === 0 && !tableLinkActive) return null;

  return (
    <div className="distribution-active-filters">
      <span className="distribution-active-filters__label">Active filters</span>
      <div className="distribution-active-filters__chips custom-scrollbar">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`distribution-filter-chip ${toneClass[chip.tone ?? 'slate']}`}
            title={chip.detail ?? chip.label}
            onClick={chip.onClear}
          >
            <span className="distribution-filter-chip__text">
              <span className="distribution-filter-chip__label">{chip.label}</span>
              {chip.detail ? (
                <span className="distribution-filter-chip__detail">{chip.detail}</span>
              ) : null}
            </span>
            <X size={12} aria-hidden className="shrink-0 opacity-70" />
          </button>
        ))}
      </div>
      {tableLinkActive && onClearTableLink ? (
        <button
          type="button"
          className="distribution-active-filters__clear-link"
          onClick={onClearTableLink}
        >
          <FilterX size={12} aria-hidden />
          Clear table link
        </button>
      ) : null}
    </div>
  );
}
