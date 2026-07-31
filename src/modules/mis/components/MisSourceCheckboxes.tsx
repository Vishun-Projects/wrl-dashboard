'use client';

import type { MisSourceSelection } from '@/modules/mis/client-import';
import { selectAllSources } from '@/modules/mis/client-import';
import type { ClientMergeWithCrmPrefs } from '@/modules/mis/components/SummaryMergedMetricCell';

type SourceOption = { code: string; name: string };

type Props = {
  selection: MisSourceSelection;
  activeSources: SourceOption[];
  onChange: (selection: MisSourceSelection) => void;
  mergePrefs?: ClientMergeWithCrmPrefs;
  onMergePrefsChange?: (prefs: ClientMergeWithCrmPrefs) => void;
};

function MergeChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mis-client-merge-chip flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-bg-canvas px-2 py-1 text-[10px] text-slate-600">
      <input
        type="checkbox"
        className="mis-client-merge-checkbox h-3 w-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-label">{label}</span>
    </label>
  );
}

export default function MisSourceCheckboxes({
  selection,
  activeSources,
  onChange,
  mergePrefs,
  onMergePrefsChange,
}: Props) {
  const codes = activeSources.map((s) => s.code);
  const allSelected =
    selection.crm &&
    codes.length > 0 &&
    codes.every((c) => selection.clientSourceCodes.includes(c));

  const toggleCrm = () => onChange({ ...selection, crm: !selection.crm });

  const toggleSource = (code: string) => {
    const normalized = code.toLowerCase();
    const has = selection.clientSourceCodes.includes(normalized);
    const clientSourceCodes = has
      ? selection.clientSourceCodes.filter((c) => c !== normalized)
      : [...selection.clientSourceCodes, normalized];
    onChange({ ...selection, clientSourceCodes });
  };

  const selectAll = () => onChange(selectAllSources(codes));

  const showCadburyMerge = activeSources.some((s) => s.code.toLowerCase() === 'cadbury');
  const showCokeMerge = activeSources.some((s) => s.code.toLowerCase() === 'coke');
  const showMerge = Boolean(onMergePrefsChange && mergePrefs && (showCadburyMerge || showCokeMerge));

  if (activeSources.length === 0 && !showMerge) return null;

  return (
    <div className="mis-sources-root flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
      <span className="mis-sources-label text-slate-500 ui-label">Data sources</span>
      <label className="mis-sources-option inline-flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={selection.crm}
          onChange={toggleCrm}
          className="mis-sources-checkbox rounded border-slate-300"
        />
        CRM
      </label>
      {activeSources.map((s) => (
        <label key={s.code} className="mis-sources-option inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={selection.clientSourceCodes.includes(s.code.toLowerCase())}
            onChange={() => toggleSource(s.code)}
            className="mis-sources-checkbox rounded border-slate-300"
          />
          {s.name}
        </label>
      ))}
      <button
        type="button"
        onClick={selectAll}
        className={`mis-sources-all-btn rounded border px-2 py-0.5 text-[10px] ${
          allSelected
            ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
            : 'border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        All
      </button>
      {showMerge ? (
        <>
          {showCadburyMerge ? (
            <MergeChip
              label="Merge Cadbury CRM Calls"
              checked={mergePrefs!.cadbury}
              onChange={(cadbury) => onMergePrefsChange!({ ...mergePrefs!, cadbury })}
            />
          ) : null}
          {showCokeMerge ? (
            <MergeChip
              label="Merge Coke CRM Calls"
              checked={mergePrefs!.coke}
              onChange={(coke) => onMergePrefsChange!({ ...mergePrefs!, coke })}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
