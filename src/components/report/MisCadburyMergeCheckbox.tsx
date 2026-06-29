'use client';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export default function MisCadburyMergeCheckbox({ checked, onChange, className = '' }: Props) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 ${className}`}
    >
      <input
        type="checkbox"
        className="h-3 w-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-label">Merge Cadbury CRM Calls</span>
    </label>
  );
}
