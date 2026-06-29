'use client';

import type { MisSourceSelection } from '@/lib/mis-client-import/source-selection';
import { selectAllSources } from '@/lib/mis-client-import/source-selection';

type SourceOption = { code: string; name: string };

type Props = {
  selection: MisSourceSelection;
  activeSources: SourceOption[];
  onChange: (selection: MisSourceSelection) => void;
};

export default function MisSourceCheckboxes({ selection, activeSources, onChange }: Props) {
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

  if (activeSources.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
      <span className="text-slate-500 ui-label">Data sources</span>
      <label className="inline-flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={selection.crm}
          onChange={toggleCrm}
          className="rounded border-slate-300"
        />
        CRM
      </label>
      {activeSources.map((s) => (
        <label key={s.code} className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={selection.clientSourceCodes.includes(s.code.toLowerCase())}
            onChange={() => toggleSource(s.code)}
            className="rounded border-slate-300"
          />
          {s.name}
        </label>
      ))}
      <button
        type="button"
        onClick={selectAll}
        className={`rounded border px-2 py-0.5 text-[10px] ${
          allSelected
            ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
            : 'border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        All
      </button>
    </div>
  );
}
