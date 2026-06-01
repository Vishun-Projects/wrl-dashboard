'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { RegisterFilterBar } from '@/components/RegisterFilterBar';
import { countActiveFilters, defaultDateRange } from '@/lib/report-filters';
import { resolveRegisterDateSqlColumn } from '@/lib/trhcalls-query';
import { useReportFilters } from '@/contexts/ReportFiltersContext';

type RegisterFilterDrawerProps = {
  open: boolean;
  onClose: () => void;
  onClear?: () => void;
  onApply?: () => void;
  applyDisabled?: boolean;
  drawerExtra?: React.ReactNode;
  extraFilterCount?: number;
};

export function RegisterFilterDrawer({
  open,
  onClose,
  onClear,
  onApply,
  applyDisabled = false,
  drawerExtra,
  extraFilterCount = 0,
}: RegisterFilterDrawerProps) {
  const {
    search,
    pincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedStatus,
    selectedCallTypes,
    priorityFilter,
    portalFilter,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    clearAllFilters,
    setDateRange,
    setDateFilterColumn,
    applyFilters,
  } = useReportFilters();

  const filterCount = countActiveFilters({
    search,
    pincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedStatus,
    selectedCallTypes,
    priorityFilter,
    portalFilter,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedOfficeIds: [],
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleClear = () => {
    clearAllFilters();
    setDateRange(defaultDateRange());
    setDateFilterColumn(resolveRegisterDateSqlColumn(undefined));
    applyFilters();
    onClear?.();
  };

  return (
    <div className="register-filter-drawer-root">
      <button
        type="button"
        className="register-filter-drawer-backdrop"
        aria-label="Close filters"
        onClick={onClose}
      />
      <aside className="register-filter-drawer" role="dialog" aria-modal="true" aria-label="Filters">
        <div className="register-filter-drawer-header">
          <div>
            <h2 className="register-filter-drawer-title">Filters</h2>
            {filterCount + extraFilterCount > 0 && (
              <p className="register-filter-drawer-subtitle">
                {filterCount + extraFilterCount} active
              </p>
            )}
          </div>
          <div className="register-filter-drawer-header-actions">
            {filterCount + extraFilterCount > 0 && (
              <button type="button" onClick={handleClear} className="register-filter-drawer-clear">
                Clear all
              </button>
            )}
            <button type="button" onClick={onClose} className="register-filter-drawer-close" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="register-filter-drawer-body custom-scrollbar">
          <RegisterFilterBar layout="drawer-content" applyMode="instant" showClearButton={false} />
          {drawerExtra}
        </div>

        <div className="register-filter-drawer-footer register-filter-drawer-footer--actions">
          <button type="button" onClick={onClose} className="register-filter-drawer-done register-filter-drawer-done--secondary">
            Close
          </button>
          {onApply && (
            <button
              type="button"
              onClick={onApply}
              disabled={applyDisabled}
              className="register-filter-drawer-done register-filter-drawer-done--primary disabled:opacity-50"
            >
              Apply filters
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
