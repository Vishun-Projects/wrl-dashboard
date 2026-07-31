'use client';

import React, { useState } from 'react';
import { ChevronDown, Columns3 } from 'lucide-react';
import {
  REGISTER_TABLE_COLUMNS,
  REGISTER_TABLE_COLUMN_KEYS,
  type RegisterTableColumnKey,
} from '@/features/register/services/table-columns';

type RegisterColumnPickerProps = {
  visibleColumns: RegisterTableColumnKey[];
  onChange: (columns: RegisterTableColumnKey[]) => void;
};

function orderColumns(keys: RegisterTableColumnKey[]): RegisterTableColumnKey[] {
  return REGISTER_TABLE_COLUMN_KEYS.filter((key) => keys.includes(key));
}

export function RegisterColumnPicker({ visibleColumns, onChange }: RegisterColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const [tempSelected, setTempSelected] = useState<RegisterTableColumnKey[]>([]);

  const toggleOpen = () => {
    if (!open) {
      setTempSelected([...visibleColumns]);
    }
    setOpen(!open);
  };

  const hiddenCount = REGISTER_TABLE_COLUMN_KEYS.length - visibleColumns.length;
  const buttonLabel =
    hiddenCount === 0
      ? 'All columns'
      : visibleColumns.length === 1
        ? REGISTER_TABLE_COLUMNS.find((c) => c.key === visibleColumns[0])?.label || '1 column'
        : `${visibleColumns.length} columns`;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggleOpen}
        className="register-filter-btn max-w-[10rem]"
        title="Choose visible columns"
      >
        <Columns3 size={12} className="shrink-0 text-slate-500" />
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-bg-canvas shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-bg-soft p-2">
              <span className="text-[10px] text-slate-500 ui-label">Visible columns</span>
              <button
                type="button"
                onClick={() => setTempSelected([])}
                className="text-[10px] text-slate-400 hover:text-slate-900"
              >
                Clear
              </button>
            </div>
            <div className="custom-scrollbar max-h-56 overflow-y-auto p-1">
              {REGISTER_TABLE_COLUMNS.map((col) => {
                const isSelected = tempSelected.includes(col.key);
                return (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-soft"
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3 rounded border-slate-300"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setTempSelected((prev) => [...prev, col.key]);
                        } else {
                          setTempSelected((prev) => prev.filter((key) => key !== col.key));
                        }
                      }}
                    />
                    <span className={`text-[11px] ${isSelected ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                      {col.label}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-bg-soft p-1.5">
              <button
                type="button"
                onClick={() => setTempSelected([...REGISTER_TABLE_COLUMN_KEYS])}
                className="text-[10px] text-slate-400 hover:text-slate-900"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tempSelected.length === 0) return;
                  onChange(orderColumns(tempSelected));
                  setOpen(false);
                }}
                disabled={tempSelected.length === 0}
                className="rounded bg-slate-900 px-3 py-0.5 text-[10px] text-white disabled:opacity-40"
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
