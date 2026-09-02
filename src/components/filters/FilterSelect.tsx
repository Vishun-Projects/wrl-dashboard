'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { resolveFilterSelectSearchable } from '@/components/filters/filter-select-utils';

export type { FilterSelectOption } from '@/components/filters/filter-select-types';

export type FilterSelectProps = {
  label: string;
  emptyLabel?: string;
  options: FilterSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  mode?: 'multi' | 'single';
  searchable?: boolean;
  searchPlaceholder?: string;
  panelClassName?: string;
  layout?: 'block' | 'inline';
  showSelectAll?: boolean;
  selectAllLabel?: string;
  selectAllPredicate?: (option: FilterSelectOption) => boolean;
  onSearchChange?: (query: string) => void;
  /** @deprecated Ignored — selection applies on tick. */
  applyMode?: 'instant' | 'confirm';
};

function panelWidthPx(panelClassName: string): number {
  if (panelClassName.includes('w-80')) return 320;
  if (panelClassName.includes('w-64')) return 256;
  return 224;
}

function resolveSearchable(
  searchable: boolean | undefined,
  options: FilterSelectOption[]
): boolean {
  return resolveFilterSelectSearchable(searchable, options);
}

export function FilterSelect({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  mode = 'multi',
  searchable,
  searchPlaceholder = 'Search...',
  panelClassName = 'w-56',
  layout = 'block',
  showSelectAll,
  selectAllLabel = 'Select all',
  selectAllPredicate,
  onSearchChange,
}: FilterSelectProps) {
  const isMulti = mode === 'multi';
  const isSearchable = resolveSearchable(searchable, options);
  const showSelectAllPanel =
    isMulti && (showSelectAll ?? true);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const [portalReady, setPortalReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const displayLabel = emptyLabel || label;
  const buttonText =
    selected.length === 0
      ? displayLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label || displayLabel
        : `${selected.length} selected`;

  const filteredOptions =
    isSearchable && search
      ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
      : options;

  const widthPx = panelWidthPx(panelClassName);

  const positionPanel = useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;

    const trigger = root.getBoundingClientRect();
    const panelHeight = panel.offsetHeight;
    const margin = 8;
    const gap = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = trigger.left;
    if (left + widthPx > vw - margin) {
      left = Math.max(margin, trigger.right - widthPx);
    }
    if (left < margin) left = margin;

    let top = trigger.bottom + gap;
    if (top + panelHeight > vh - margin) {
      const above = trigger.top - panelHeight - gap;
      if (above >= margin) top = above;
      else top = Math.max(margin, vh - panelHeight - margin);
    }

    setPanelStyle({
      position: 'fixed',
      left,
      top,
      width: widthPx,
      zIndex: 200,
      visibility: 'visible',
    });
  }, [widthPx]);

  useLayoutEffect(() => {
    if (!open) return;
    positionPanel();
    const onReflow = () => positionPanel();
    window.addEventListener('resize', onReflow);

    const scrollParent = rootRef.current?.closest('.register-filter-drawer-body');
    const onScrollClose = () => setOpen(false);
    scrollParent?.addEventListener('scroll', onScrollClose, { passive: true });
    window.addEventListener('scroll', onReflow, true);

    return () => {
      window.removeEventListener('resize', onReflow);
      scrollParent?.removeEventListener('scroll', onScrollClose);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, positionPanel, filteredOptions.length, search]);

  const toggleOpen = () => {
    if (!open) {
      setSearch('');
      setPanelStyle({ visibility: 'hidden' });
    }
    setOpen(!open);
  };

  const pickValue = (value: string) => {
    if (isMulti) {
      const next = selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value];
      onChange(next);
      return;
    }
    onChange([value]);
    setOpen(false);
  };

  const handleClear = () => {
    onChange([]);
    if (!isMulti) setOpen(false);
  };

  const selectAllTargets = selectAllPredicate
    ? filteredOptions.filter(selectAllPredicate)
    : filteredOptions;

  const handleSelectAll = () => {
    const targetValues = selectAllTargets.map((o) => o.value);
    onChange([...new Set([...selected, ...targetValues])]);
  };

  const panel =
    open && portalReady ? (
      <>
        <div
          className="fixed inset-0 z-[190]"
          onClick={() => setOpen(false)}
          aria-hidden
        />
        <div
          ref={panelRef}
          style={panelStyle}
          className="overflow-hidden rounded-lg border border-slate-200 bg-bg-canvas shadow-2xl"
          role="listbox"
          aria-label={label}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-bg-soft px-2.5 py-2">
            <span className="ui-field-label shrink-0 text-slate-700">{label}</span>
            <div className="flex shrink-0 items-center gap-2">
              {showSelectAllPanel && selectAllTargets.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="ui-micro text-slate-600 hover:text-slate-900"
                >
                  {selectAllLabel}
                </button>
              )}
              <button
                type="button"
                onClick={handleClear}
                className="ui-micro text-slate-500 hover:text-slate-900"
              >
                Clear
              </button>
            </div>
          </div>
          {isSearchable && (
            <div className="border-b border-slate-100 p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  className="ui-help w-full rounded border border-slate-200 py-1.5 pl-7 pr-2 outline-none focus:border-slate-400"
                  value={search}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSearch(next);
                    onSearchChange?.(next);
                  }}
                />
              </div>
            </div>
          )}
          <div className="custom-scrollbar max-h-52 overflow-y-auto p-1.5">
            {filteredOptions.length === 0 ? (
              <p className="ui-help px-2 py-3 text-center text-slate-500">No options</p>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      pickValue(option.value);
                    }}
                    className={`mb-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none last:mb-0 focus-visible:ring-2 focus-visible:ring-blue-400 ${
                      isSelected
                        ? 'border border-blue-200 bg-blue-50 text-blue-900'
                        : 'border border-transparent hover:bg-bg-soft'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? 'border-blue-700 bg-blue-700 text-white'
                          : 'border-slate-300 bg-bg-canvas'
                      }`}
                      aria-hidden
                    >
                      {isSelected ? <Check size={11} strokeWidth={3} /> : null}
                    </span>
                    <span
                      className={`ui-help min-w-0 flex-1 leading-snug ${isSelected ? 'font-semibold' : ''}`}
                    >
                      {option.label}
                    </span>
                    {option.count != null ? (
                      <span className="ui-micro shrink-0 tabular-nums text-slate-500">
                        {option.count.toLocaleString()}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={
        layout === 'inline'
          ? 'filter-select-root register-multi-select-root relative min-w-[10rem] max-w-[14rem] flex-[1_1_11rem] shrink-0'
          : 'filter-select-root register-multi-select-root relative min-w-0 w-full'
      }
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="register-filter-btn w-full"
        title={buttonText}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {portalReady && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
