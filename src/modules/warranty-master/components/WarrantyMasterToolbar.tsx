'use client';

import React from 'react';
import { RegisterMultiSelect } from '@/modules/mis/register/components/RegisterMultiSelect';
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
  onResetAll,
  isFiltering,
}: WarrantyMasterToolbarProps) {
  const hasEndDates = Boolean(filters.warrEndFrom || filters.warrEndTo);

  return (
    <div className="relative z-20 shrink-0 border-b border-slate-200 bg-bg-canvas">
      <div className="report-toolbar-filters-row px-3 py-1.5">
        <RegisterMultiSelect
          label="Customer"
          emptyLabel="All customers"
          layout="inline"
          options={customerOptions}
          selected={filters.selectedCustomer}
          onChange={onCustomerChange}
          searchable
          searchPlaceholder="Search…"
          panelClassName="w-72"
        />
        <RegisterMultiSelect
          label="Group"
          emptyLabel="All groups"
          layout="inline"
          options={groupOptions}
          selected={filters.selectedGroup}
          onChange={onGroupChange}
          searchable
          panelClassName="w-56"
        />
        <RegisterMultiSelect
          label="FG model"
          emptyLabel="All FG models"
          layout="inline"
          options={fgModelOptions}
          selected={filters.selectedFgModel}
          onChange={onFgModelChange}
          searchable
          searchPlaceholder="Search…"
          panelClassName="w-56"
        />
        <RegisterMultiSelect
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
