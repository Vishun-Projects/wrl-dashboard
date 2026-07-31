'use client';

import { Filter, Loader2 } from 'lucide-react';
import { UiDateInput } from '@/components/ui/UiDateInput';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { RegisterBranchFranchiseeFilters } from '@/modules/mis/register/components/RegisterBranchFranchiseeFilters';
import { RegisterMultiSelect } from '@/modules/mis/register/components/RegisterMultiSelect';
import type { RegisterMultiSelectOption } from '@/modules/mis/register';
import {
  saveMisSourceSelection,
  type MisSourceSelection,
} from '@/modules/mis/client-import';
import MisSourceCheckboxes from '@/modules/mis/components/MisSourceCheckboxes';
import { saveClientMergeWithCrmPrefs } from '@/modules/mis/components/MisClientMergeCheckbox';
import type { ClientMergeWithCrmPrefs } from '@/modules/mis/components/SummaryMergedMetricCell';
import type { ReportDateRange } from '@/modules/mis/services/filters';

type Props = {
  callTypeOptions: RegisterMultiSelectOption[];
  selectedCallTypes: string[];
  setSelectedCallTypes: (v: string[]) => void;
  dateRange: ReportDateRange;
  setDateRange: (range: ReportDateRange) => void;
  agingAsOf: string;
  setAgingAsOf: (iso: string) => void;
  onApply: () => void;
  summaryTabLoading: boolean;
  bdMisTabLoading: boolean;
  hasPendingFilterChanges: boolean;
  clientImportActiveSources: Array<{ code: string; name: string }>;
  sourceSelection: MisSourceSelection;
  setSourceSelection: (s: MisSourceSelection) => void;
  clientMergeWithCrm: ClientMergeWithCrmPrefs;
  setClientMergeWithCrm: (p: ClientMergeWithCrmPrefs) => void;
};

export function ReportSharedFiltersBar({
  callTypeOptions,
  selectedCallTypes,
  setSelectedCallTypes,
  dateRange,
  setDateRange,
  agingAsOf,
  setAgingAsOf,
  onApply,
  summaryTabLoading,
  bdMisTabLoading,
  hasPendingFilterChanges,
  clientImportActiveSources,
  sourceSelection,
  setSourceSelection,
  clientMergeWithCrm,
  setClientMergeWithCrm,
}: Props) {
  const applying = summaryTabLoading || bdMisTabLoading;
  return (
    <div className="report-toolbar-filters-row report-shared-filters-surface border-b border-slate-200 bg-bg-canvas px-4 py-2">
      <RegisterMultiSelect
        label="Call Type"
        emptyLabel="All Call Types"
        options={callTypeOptions}
        selected={selectedCallTypes}
        onChange={setSelectedCallTypes}
        applyMode="confirm"
        layout="inline"
        searchable
        panelClassName="w-64"
      />
      <RegisterBranchFranchiseeFilters applyMode="confirm" layout="inline" />
      <div className="report-toolbar-filters-date report-shared-date-field shrink-0">
        <DateRangeSelector
          value={dateRange.label}
          startDate={dateRange.start}
          endDate={dateRange.end}
          onChange={(range) => setDateRange(range)}
        />
      </div>
      <div className="report-toolbar-filters-aging report-shared-aging-group flex shrink-0 items-center gap-2">
        <span className="report-shared-aging-label ui-micro whitespace-nowrap text-amber-600">
          Aging As Of
        </span>
        <UiDateInput
          className="register-filter-select report-shared-aging-input border-amber-200 bg-amber-50/80 text-amber-900"
          value={agingAsOf}
          max={new Date().toISOString().split('T')[0]}
          onChange={(iso) => setAgingAsOf(iso)}
          aria-label="Aging as of"
        />
      </div>
      <button
        type="button"
        onClick={onApply}
        disabled={applying}
        aria-busy={applying}
        className={`filter-apply-btn report-shared-apply-btn ${
          applying
            ? 'border border-blue-300 bg-blue-50 text-blue-800'
            : hasPendingFilterChanges
              ? 'filter-apply-btn--pending'
              : ''
        }`}
      >
        {applying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Filter className="h-3.5 w-3.5" aria-hidden />
        )}
        {applying ? 'Applying…' : 'Apply filters'}
      </button>
      {(clientImportActiveSources.length > 0 ||
        sourceSelection.clientSourceCodes.includes('cadbury')) && (
        <div className="report-toolbar-filters-sources report-shared-sources-group shrink-0 border-l border-slate-200 pl-2 flex flex-wrap items-center gap-2">
          <MisSourceCheckboxes
            selection={sourceSelection}
            activeSources={clientImportActiveSources}
            onChange={(selection) => {
              saveMisSourceSelection(selection);
              setSourceSelection(selection);
            }}
            mergePrefs={clientMergeWithCrm}
            onMergePrefsChange={(prefs) => {
              setClientMergeWithCrm(prefs);
              saveClientMergeWithCrmPrefs(prefs);
            }}
          />
        </div>
      )}
    </div>
  );
}
