'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { UiDateInput } from '@/components/ui/UiDateInput';
import type { WarrantyMasterClientFilters } from '@/modules/warranty-master/services';

type SelectOption = { value: string; label: string };

type WarrantyMasterToolbarProps = {
  customerOptions: SelectOption[];
  groupOptions: SelectOption[];
  fgModelOptions: SelectOption[];
  warrantyMonthOptions: SelectOption[];
  filters: WarrantyMasterClientFilters;
  onCustomerChange: (values: string[]) => void;
  onGroupChange: (values: string[]) => void;
  onFgModelChange: (values: string[]) => void;
  onWarrantyMonthsChange: (values: string[]) => void;
  onActiveOnlyChange: (value: boolean) => void;
  onWarrEndFromChange: (value: string) => void;
  onWarrEndToChange: (value: string) => void;
  onSerialSearchChange?: (value: string) => void;
  onResetAll: () => void;
  isFiltering: boolean;
};

export function WarrantyMasterToolbar({
  customerOptions,
  groupOptions,
  fgModelOptions,
  warrantyMonthOptions,
  filters,
  onCustomerChange,
  onGroupChange,
  onFgModelChange,
  onWarrantyMonthsChange,
  onActiveOnlyChange,
  onWarrEndFromChange,
  onWarrEndToChange,
  onSerialSearchChange,
  onResetAll,
  isFiltering,
}: WarrantyMasterToolbarProps) {
  const hasEndDates = Boolean(filters.warrEndFrom || filters.warrEndTo);

  return (
    <div className="relative z-20 shrink-0 border-b border-slate-200 bg-bg-canvas">
      <div className="report-toolbar-filters-row px-3 py-1.5 flex flex-wrap items-center gap-2">
        <div className="relative flex items-center min-w-[180px] max-w-[220px]">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={filters.serialSearch}
            onChange={(e) => onSerialSearchChange?.(e.target.value)}
            placeholder="Search serial no…"
            className="h-7 w-full rounded border border-slate-200 bg-white pl-8 pr-7 text-[11px] text-slate-800 placeholder-slate-400 transition-colors focus:border-slate-400 focus:outline-none"
          />
          {filters.serialSearch ? (
            <button
              type="button"
              onClick={() => onSerialSearchChange?.('')}
              className="absolute right-2 text-slate-400 hover:text-slate-600"
              title="Clear serial search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <FilterSelect
          label="Customer Subgroup"
          emptyLabel="All subgroups"
          layout="inline"
          options={customerOptions}
          selected={filters.selectedCustomer}
          onChange={onCustomerChange}
          searchPlaceholder="Search…"
          panelClassName="w-72"
        />
        <FilterSelect
          label="Group"
          emptyLabel="All groups"
          layout="inline"
          options={groupOptions}
          selected={filters.selectedGroup}
          onChange={onGroupChange}
          panelClassName="w-56"
        />
        <FilterSelect
          label="FG model"
          emptyLabel="All FG models"
          layout="inline"
          options={fgModelOptions}
          selected={filters.selectedFgModel}
          onChange={onFgModelChange}
          searchPlaceholder="Search…"
          panelClassName="w-56"
        />
        <FilterSelect
          label="Warranty"
          emptyLabel="All months"
          layout="inline"
          options={warrantyMonthOptions}
          selected={filters.selectedWarrantyMonths}
          onChange={onWarrantyMonthsChange}
          panelClassName="w-44"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-1.5">
        <button
          type="button"
          onClick={() => onActiveOnlyChange(!filters.activeOnly)}
          className={`inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[10px] font-medium transition-colors ${
            filters.activeOnly
              ? 'border-teal-700 bg-teal-50 text-teal-800'
              : 'border-slate-200 bg-bg-canvas text-slate-600 hover:border-slate-300'
          }`}
        >
          Active warranty today
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
            Ends
          </span>
          <UiDateInput
            value={filters.warrEndFrom}
            onChange={onWarrEndFromChange}
            className="h-7 min-w-[6.5rem] text-[11px]"
            aria-label="Warranty end from"
          />
          <span className="text-[10px] text-slate-300">–</span>
          <UiDateInput
            value={filters.warrEndTo}
            onChange={onWarrEndToChange}
            className="h-7 min-w-[6.5rem] text-[11px]"
            aria-label="Warranty end to"
          />
        </div>

        {isFiltering ? (
          <button
            type="button"
            onClick={onResetAll}
            className="shrink-0 text-[10px] font-medium text-slate-500 underline hover:text-slate-800"
          >
            Reset filters
          </button>
        ) : null}

        {hasEndDates ? (
          <button
            type="button"
            onClick={() => {
              onWarrEndFromChange('');
              onWarrEndToChange('');
            }}
            className="shrink-0 text-[10px] text-slate-400 hover:text-slate-700"
          >
            Clear dates
          </button>
        ) : null}
      </div>
    </div>
  );
}
