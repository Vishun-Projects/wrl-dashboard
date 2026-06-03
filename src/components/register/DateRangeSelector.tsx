'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { formatLocalDate, parseLocalDateString, endOfLocalDay, startOfLocalDay } from '@/lib/report/filters';

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

export function DateRangeSelector({ value, startDate, endDate, onChange }: DateRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  let currentLabel = ranges.find(r => r.label === value || (value === '30' && r.label === 'Last 30 Days') || (value === '14' && r.label === 'Last 14 Days') || (value === '7' && r.label === 'Last 7 Days'))?.label || value || 'Select Range';
  if (value === 'Custom Range' && startDate && endDate) {
    const formatDt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    currentLabel = `${formatDt(startDate)} - ${formatDt(endDate)}`;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 px-3 bg-white border border-[#e2e8f0] rounded-lg flex items-center gap-2 hover:border-slate-400 transition-all text-[#475569] text-[12px] font-medium min-w-[130px] shadow-sm active:scale-95"
      >
        <Calendar size={14} className="text-slate-400" />
        <span className="flex-1 text-left">{currentLabel}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-[180px] bg-white border border-slate-200 shadow-xl rounded-xl z-[150] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
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
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12px] transition-colors ${isSelected ? 'bg-slate-900 text-white font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {range.label}
                  {isSelected && <Check size={12} className="text-emerald-400" />}
                </button>
              );
            })}
          </div>
          <div className="p-3 bg-slate-50 border-t border-slate-100 space-y-2">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 ui-label">Custom Start</label>
              <input
                type="date"
                className="w-full h-8 px-2 bg-white border border-slate-200 rounded text-[11px] outline-none focus:border-slate-400"
                value={value === 'Custom Range' && startDate ? formatLocalDate(startDate) : ''}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const d = parseLocalDateString(e.target.value);
                  if (!isNaN(d.getTime())) {
                    const activeEnd = endDate ? endOfLocalDay(endDate) : endOfLocalDay(new Date());
                    onChange({ start: d, end: activeEnd, label: 'Custom Range' });
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 ui-label">Custom End</label>
              <input
                type="date"
                className="w-full h-8 px-2 bg-white border border-slate-200 rounded text-[11px] outline-none focus:border-slate-400"
                value={value === 'Custom Range' && endDate ? formatLocalDate(endDate) : ''}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const d = parseLocalDateString(e.target.value);
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
      )}
    </div>
  );
}
