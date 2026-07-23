'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { formatLocalDate, parseLocalDateString, endOfLocalDay, startOfLocalDay } from '@/features/report';
import { formatUiDate } from '@/lib/dates/ui-date';
import { UiDateInput } from '@/components/ui/UiDateInput';

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

interface DateRangeSelectorProps {
  value: string; // The label or a period string
  startDate?: Date;
  endDate?: Date;
  onChange: (range: DateRange) => void;
}

const PANEL_WIDTH = 180;

export function DateRangeSelector({ value, startDate, endDate, onChange }: DateRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const ranges = [
    {
      label: 'Today', getValue: () => {
        const d = new Date();
        return { start: new Date(d.setHours(0, 0, 0, 0)), end: new Date(d.setHours(23, 59, 59, 999)), label: 'Today' };
      }
    },
    {
      label: 'Yesterday', getValue: () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return { start: new Date(d.setHours(0, 0, 0, 0)), end: new Date(d.setHours(23, 59, 59, 999)), label: 'Yesterday' };
      }
    },
    {
      label: 'Last 7 Days', getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 7);
        return { start: new Date(start.setHours(0, 0, 0, 0)), end, label: 'Last 7 Days' };
      }
    },
    {
      label: 'Last 14 Days', getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 14);
        return { start: new Date(start.setHours(0, 0, 0, 0)), end, label: 'Last 14 Days' };
      }
    },
    {
      label: 'Last 30 Days', getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 30);
        return { start: new Date(start.setHours(0, 0, 0, 0)), end, label: 'Last 30 Days' };
      }
    },
    {
      label: 'This Month', getValue: () => {
        const d = new Date();
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        return { start, end: new Date(), label: 'This Month' };
      }
    },
    {
      label: 'Last Month', getValue: () => {
        const d = new Date();
        const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        const end = new Date(d.getFullYear(), d.getMonth(), 0);
        return { start, end, label: 'Last Month' };
      }
    },
  ];

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const positionPanel = useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;

    const trigger = root.getBoundingClientRect();
    const panelHeight = panel.offsetHeight;
    const margin = 8;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = trigger.right - PANEL_WIDTH;
    if (left + PANEL_WIDTH > vw - margin) {
      left = Math.max(margin, trigger.right - PANEL_WIDTH);
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
      width: PANEL_WIDTH,
      zIndex: 200,
      visibility: 'visible',
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    positionPanel();
    const onReflow = () => positionPanel();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [isOpen, positionPanel, value, startDate, endDate]);

  const toggleOpen = () => {
    if (!isOpen) {
      setPanelStyle({ visibility: 'hidden' });
    }
    setIsOpen(!isOpen);
  };

  let currentLabel = ranges.find(r => r.label === value || (value === '30' && r.label === 'Last 30 Days') || (value === '14' && r.label === 'Last 14 Days') || (value === '7' && r.label === 'Last 7 Days'))?.label || value || 'Select Range';
  if (value === 'Custom Range' && startDate && endDate) {
    currentLabel = `${formatUiDate(startDate)} - ${formatUiDate(endDate)}`;
  }

  const panel =
    isOpen && portalReady ? (
      <>
        <div
          className="fixed inset-0 z-[190]"
          onClick={() => setIsOpen(false)}
          aria-hidden
        />
        <div
          ref={panelRef}
          style={panelStyle}
          className="overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-xl animate-in fade-in zoom-in-95 duration-200"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="p-1.5">
            {ranges.map((range) => {
              const isSelected = currentLabel === range.label;
              return (
                <button
                  key={range.label}
                  onClick={() => {
                    onChange(range.getValue());
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12px] transition-colors ${isSelected ? 'bg-slate-900 text-white font-bold' : 'text-slate-600 hover:bg-bg-soft'}`}
                >
                  {range.label}
                  {isSelected && <Check size={12} className="text-emerald-400" />}
                </button>
              );
            })}
          </div>
          <div className="p-3 bg-bg-soft border-t border-slate-100 space-y-2">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 ui-label">Custom Start</label>
              <UiDateInput
                className="w-full border-slate-200"
                value={value === 'Custom Range' && startDate ? formatLocalDate(startDate) : ''}
                aria-label="Custom start date"
                onChange={(iso) => {
                  if (!iso) return;
                  const d = parseLocalDateString(iso);
                  if (!isNaN(d.getTime())) {
                    const activeEnd = endDate ? endOfLocalDay(endDate) : endOfLocalDay(new Date());
                    onChange({ start: d, end: activeEnd, label: 'Custom Range' });
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 ui-label">Custom End</label>
              <UiDateInput
                className="w-full border-slate-200"
                value={value === 'Custom Range' && endDate ? formatLocalDate(endDate) : ''}
                aria-label="Custom end date"
                onChange={(iso) => {
                  if (!iso) return;
                  const d = parseLocalDateString(iso);
                  if (!isNaN(d.getTime())) {
                    const activeStart = startDate
                      ? startOfLocalDay(startDate)
                      : (() => {
                          const s = new Date();
                          s.setDate(s.getDate() - 30);
                          return startOfLocalDay(s);
                        })();
                    onChange({ start: activeStart, end: endOfLocalDay(d), label: 'Custom Range' });
                  }
                }}
              />
            </div>
          </div>
        </div>
      </>
    ) : null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggleOpen}
        className="register-filter-btn min-w-[130px] gap-2 text-[12px] active:scale-95"
      >
        <Calendar size={14} className="shrink-0 opacity-60" />
        <span className="flex-1 truncate text-left">{currentLabel}</span>
        <ChevronDown size={14} className={`shrink-0 opacity-60 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {portalReady && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
