'use client';

import type { ClientMergeWithCrmPrefs } from '@/features/report/ui/SummaryMergedMetricCell';

type Props = {
  prefs: ClientMergeWithCrmPrefs;
  showCadbury: boolean;
  showCoke: boolean;
  onChange: (prefs: ClientMergeWithCrmPrefs) => void;
  className?: string;
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

export default function MisClientMergeCheckbox({
  prefs,
  showCadbury,
  showCoke,
  onChange,
  className = '',
}: Props) {
  if (!showCadbury && !showCoke) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {showCadbury ? (
        <MergeChip
          label="Merge Cadbury CRM Calls"
          checked={prefs.cadbury}
          onChange={(cadbury) => onChange({ ...prefs, cadbury })}
        />
      ) : null}
      {showCoke ? (
        <MergeChip
          label="Merge Coke CRM Calls"
          checked={prefs.coke}
          onChange={(coke) => onChange({ ...prefs, coke })}
        />
      ) : null}
    </div>
  );
}

export const CLIENT_MERGE_PREFS_STORAGE_KEY = 'report_client_merge_crm';

export function loadClientMergeWithCrmPrefs(): ClientMergeWithCrmPrefs {
  if (typeof window === 'undefined') {
    return { cadbury: false, coke: false };
  }
  try {
    const raw = localStorage.getItem(CLIENT_MERGE_PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ClientMergeWithCrmPrefs>;
      return {
        cadbury: parsed.cadbury === true,
        coke: parsed.coke === true,
      };
    }
  } catch {
    /* ignore */
  }
  const legacyCadbury = localStorage.getItem('report_cadbury_merge_crm') === 'true';
  return { cadbury: legacyCadbury, coke: false };
}

export function saveClientMergeWithCrmPrefs(prefs: ClientMergeWithCrmPrefs): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CLIENT_MERGE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
}
