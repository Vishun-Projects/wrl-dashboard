'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { parseOutlookEmailList } from '@/features/mis-email/lib/parse-outlook-emails';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function normalizeChipEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeChipDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

export function isValidChipEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function isValidChipDomain(value: string): boolean {
  return DOMAIN_RE.test(value);
}

function splitRawTokens(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Prefer Outlook-style extract; fall back to comma/semicolon split. */
function splitEmailTokens(raw: string): string[] {
  const outlook = parseOutlookEmailList(raw);
  return outlook.length > 0 ? outlook : splitRawTokens(raw);
}

export function TagChipsInput({
  label,
  values,
  onChange,
  placeholder = 'Type and press Enter',
  hint,
  compact = false,
  normalize = (v) => v.trim().toLowerCase(),
  validate,
  invalidMessage = (v) => `Invalid value: ${v}`,
  splitTokens = splitRawTokens,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  compact?: boolean;
  normalize?: (raw: string) => string;
  validate?: (value: string) => boolean;
  invalidMessage?: (value: string) => string;
  splitTokens?: (raw: string) => string[];
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function commitTokens(raw: string) {
    const tokens = splitTokens(raw);
    if (tokens.length === 0) return;

    const next = [...values];
    let firstError = '';
    for (const token of tokens) {
      const value = normalize(token);
      if (!value) continue;
      if (validate && !validate(value)) {
        if (!firstError) firstError = invalidMessage(value);
        continue;
      }
      if (!next.includes(value)) next.push(value);
    }

    if (next.length !== values.length) onChange(next);
    if (firstError) {
      setError(firstError);
      return;
    }
    setDraft('');
    setError('');
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[11px] font-medium text-slate-500">
          {label}
          <span className="ml-1 font-normal text-slate-400">· {values.length}</span>
        </label>
        {hint ? <span className="text-[10px] text-slate-400">{hint}</span> : null}
      </div>
      <div className="rounded-md border border-slate-200 bg-bg-canvas p-2 focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-200">
        <div className="mb-2 flex min-h-[28px] flex-wrap gap-1.5">
          {values.length === 0 ? (
            <span className="px-1 text-[11px] text-slate-400">Nothing added yet</span>
          ) : (
            values.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onChange(values.filter((v) => v !== item))}
                title={`Remove ${item}`}
                aria-label={`Remove ${item}`}
                className={`group inline-flex max-w-full cursor-pointer items-center gap-0.5 rounded-full border border-slate-200 bg-bg-soft text-left text-[11px] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                  compact ? 'py-0 pl-2 pr-0.5' : 'py-0.5 pl-2.5 pr-0.5'
                }`}
              >
                <span className="truncate">{item}</span>
                <span
                  className={`inline-flex shrink-0 items-center justify-center rounded-full text-slate-500 group-hover:bg-slate-200/80 ${
                    compact ? 'h-6 w-6' : 'h-7 w-7'
                  }`}
                  aria-hidden
                >
                  <X size={14} />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                commitTokens(draft);
              }
              if (event.key === 'Backspace' && !draft && values.length > 0) {
                onChange(values.slice(0, -1));
              }
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (!text || (!text.includes(',') && !text.includes(';') && !text.includes('\n'))) {
                return;
              }
              event.preventDefault();
              commitTokens(text);
            }}
            onBlur={() => {
              if (draft.trim()) commitTokens(draft);
            }}
            placeholder={placeholder}
            className="h-8 min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => commitTokens(draft)}
            disabled={!draft.trim()}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-bg-soft px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      </div>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}

export function EmailChipsInput({
  label,
  values,
  onChange,
  hint = 'Enter, comma, or paste a list',
  compact = false,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <TagChipsInput
      label={label}
      values={values}
      onChange={onChange}
      hint={hint}
      compact={compact}
      placeholder="name@westernequipments.com"
      normalize={normalizeChipEmail}
      validate={isValidChipEmail}
      invalidMessage={(v) => `Invalid email: ${v}`}
      splitTokens={splitEmailTokens}
    />
  );
}

export function DomainChipsInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <TagChipsInput
      label={label}
      values={values}
      onChange={onChange}
      hint="Enter or paste domains"
      placeholder="westernequipments.com"
      normalize={normalizeChipDomain}
      validate={isValidChipDomain}
      invalidMessage={(v) => `Invalid domain: ${v}`}
    />
  );
}
