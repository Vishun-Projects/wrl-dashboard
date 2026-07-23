'use client';

import React, { useRef } from 'react';
import { formatUiDate } from '@/lib/dates/ui-date';

type UiDateInputProps = {
  /** ISO calendar date `YYYY-MM-DD` (API / filter value). */
  value: string;
  onChange: (isoDate: string) => void;
  className?: string;
  max?: string;
  min?: string;
  disabled?: boolean;
  /** Accessible name for the native picker. */
  'aria-label'?: string;
  placeholder?: string;
};

/**
 * Date field that always shows dd/mm/yyyy while storing YYYY-MM-DD for APIs.
 * Opens the native picker with showPicker() on click (opacity overlay alone
 * does not open Chromium's calendar).
 */
export function UiDateInput({
  value,
  onChange,
  className = '',
  max,
  min,
  disabled,
  'aria-label': ariaLabel = 'Choose date',
  placeholder = 'dd/mm/yyyy',
}: UiDateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = formatUiDate(value) || placeholder;

  const openPicker = () => {
    if (disabled) return;
    const el = inputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') {
        void el.showPicker();
        return;
      }
    } catch {
      // fall through
    }
    el.focus();
    el.click();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={openPicker}
      className={`relative inline-flex h-8 min-w-[7.25rem] items-center rounded-md border border-slate-200 bg-bg-canvas px-2 text-left shadow-sm hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <span className="w-full text-[12px] tabular-nums text-slate-700">{label}</span>
      {/* Must stay in the DOM (not display:none) for showPicker(); not the click target */}
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        max={max}
        min={min}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      />
    </button>
  );
}
