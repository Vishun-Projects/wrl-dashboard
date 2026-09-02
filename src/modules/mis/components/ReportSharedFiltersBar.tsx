'use client';

import { UiDateInput } from '@/components/ui/UiDateInput';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { RegisterBranchFranchiseeFilters } from '@/modules/mis/register/components/RegisterBranchFranchiseeFilters';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters';
import {
  saveMisSourceSelection,
  type MisSourceSelection,
} from '@/modules/mis/client-import';
import MisSourceCheckboxes from '@/modules/mis/components/MisSourceCheckboxes';
import { saveClientMergeWithCrmPrefs } from '@/modules/mis/components/MisClientMergeCheckbox';
import type { ClientMergeWithCrmPrefs } from '@/modules/mis/components/SummaryMergedMetricCell';
import type { ReportDateRange } from '@/modules/mis/services/filters';

type Props = {
  callTypeOptions: FilterSelectOption[];
  selectedCallTypes: string[];
  setSelectedCallTypes: (v: string[]) => void;
  dateRange: ReportDateRange;
  setDateRange: (range: ReportDateRange) => void;
  agingAsOf: string;
  setAgingAsOf: (iso: string) => void;
  summaryTabLoading: boolean;
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
  summaryTabLoading,
  clientImportActiveSources,
  sourceSelection,
  setSourceSelection,
  clientMergeWithCrm,
  setClientMergeWithCrm,
}: Props) {
  return (
    <div className="report-toolbar-filters-row report-shared-filters-surface border-b border-slate-200 bg-bg-canvas px-4 py-2">
      <FilterSelect
        label="Call Type"
        emptyLabel="All Call Types"
        options={callTypeOptions}
        selected={selectedCallTypes}
        onChange={setSelectedCallTypes}
        layout="inline"
        panelClassName="w-64"
      />
      <RegisterBranchFranchiseeFilters layout="inline" />
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
      {summaryTabLoading ? (
        <span className="ui-micro text-blue-700">Updating…</span>
      ) : null}
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
