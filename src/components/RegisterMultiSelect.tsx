'use client';

import React, { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export type RegisterMultiSelectOption = {
  value: string;
  label: string;
};

type RegisterMultiSelectProps = {
  label: string;
  emptyLabel?: string;
  options: RegisterMultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  panelClassName?: string;
};

export function RegisterMultiSelect({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  searchable = false,
  searchPlaceholder = 'Search...',
  panelClassName = 'w-56',
}: RegisterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [tempSelected, setTempSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const displayLabel = emptyLabel || label;
  const buttonText =
    selected.length === 0
      ? displayLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label || displayLabel
        : `${selected.length} selected`;

  const filteredOptions = searchable && search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggleOpen = () => {
    if (!open) {
      setTempSelected([...selected]);
      setSearch('');
    }
    setOpen(!open);
  };

  return (
    <div className="relative shrink-0">
      <button type="button" onClick={toggleOpen} className="register-filter-btn">
        <span className="truncate">{buttonText}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute top-full left-0 z-50 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl ${panelClassName}`}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-2">
              <span className="text-[10px] text-slate-500 ui-label">{label}</span>
              <button
                type="button"
                onClick={() => setTempSelected([])}
                className="text-[10px] text-slate-400 hover:text-slate-900"
              >
                Clear
              </button>
            </div>
            {searchable && (
              <div className="border-b border-slate-100 p-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder={searchPlaceholder}
                    className="w-full rounded border border-slate-200 py-1 pl-6 pr-2 text-[11px] outline-none focus:border-slate-400"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            )}
            <div className="custom-scrollbar max-h-56 overflow-y-auto p-1">
              {filteredOptions.length === 0 ? (
                <p className="px-2 py-3 text-center text-[10px] text-slate-400">No options</p>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = tempSelected.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="h-3 w-3 rounded border-slate-300"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTempSelected((prev) => [...prev, option.value]);
                          } else {
                            setTempSelected((prev) => prev.filter((v) => v !== option.value));
                          }
                        }}
                      />
                      <span className="text-[11px] text-slate-700">{option.label}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex justify-end border-t border-slate-100 bg-slate-50 p-1.5">
              <button
                type="button"
                onClick={() => {
                  onChange(tempSelected);
                  setOpen(false);
                }}
                className="rounded bg-slate-900 px-3 py-0.5 text-[10px] text-white"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
