'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';

interface DateRangePickerProps {
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
}

export function DateRangePicker({ startDate, setStartDate, endDate, setEndDate }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const formatDate = (date: Date) => date.toISOString().split('T')[0];

  const presets = [
    { label: 'Today', getValue: () => ({ start: formatDate(new Date()), end: formatDate(new Date()) }) },
    { label: 'Yesterday', getValue: () => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return { start: formatDate(d), end: formatDate(d) };
    }},
    { label: 'Last 7 Days', getValue: () => {
      const d = new Date(); d.setDate(d.getDate() - 7);
      return { start: formatDate(d), end: formatDate(new Date()) };
    }},
    { label: 'Last 30 Days', getValue: () => {
      const d = new Date(); d.setDate(d.getDate() - 30);
      return { start: formatDate(d), end: formatDate(new Date()) };
    }},
    { label: 'This Month', getValue: () => {
      const d = new Date();
      return { start: formatDate(new Date(d.getFullYear(), d.getMonth(), 1)), end: formatDate(new Date()) };
    }},
    { label: 'This Year', getValue: () => {
      const d = new Date();
      return { start: formatDate(new Date(d.getFullYear(), 0, 1)), end: formatDate(new Date()) };
    }},
    { label: 'Last Year', getValue: () => {
      const d = new Date();
      return { start: formatDate(new Date(d.getFullYear() - 1, 0, 1)), end: formatDate(new Date(d.getFullYear() - 1, 11, 31)) };
    }},
    { label: 'All Time', getValue: () => ({ start: '', end: '' }) }
  ];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getActiveLabel = () => {
    if (!startDate && !endDate) return 'All Time';
    const active = presets.find(p => {
      const val = p.getValue();
      return val.start === startDate && val.end === endDate;
    });
    return active ? active.label : `${startDate} - ${endDate}`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 px-3 bg-white border border-[#e2e8f0] rounded-lg flex items-center gap-2 hover:border-slate-400 transition-all text-[#475569] text-[12px] min-w-[140px]"
      >
        <Calendar size={13} className="text-[#94a3b8]" />
        <span className="truncate flex-1 text-left">
          {getActiveLabel()}
        </span>
        <ChevronDown size={13} className={`text-[#94a3b8] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-[240px] bg-white border border-[#e2e8f0] shadow-xl rounded-xl z-[150] p-1.5 animate-in fade-in zoom-in-95 duration-200">
          <div className="grid grid-cols-1 gap-0.5">
            {presets.map(p => {
              const isActive = getActiveLabel() === p.label;
              return (
                <button
                  key={p.label}
                  onClick={() => {
                    const { start, end } = p.getValue();
                    setStartDate(start);
                    setEndDate(end);
                    setIsOpen(false);
                  }}
                  className={`flex items-center justify-between px-3 py-1.5 rounded-md text-[12px] transition-colors ${
                    isActive ? 'bg-[#0f172a] text-white' : 'text-[#475569] hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                  {isActive && <Check size={12} />}
                </button>
              );
            })}
          </div>
          
          <div className="border-t border-[#f1f5f9] mt-1.5 pt-2 px-1 pb-1">
            <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider block mb-1.5 px-2">Custom</span>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-2">
                <span className="text-[10px] text-[#94a3b8] w-8">From</span>
                <input
                  type="date"
                  className="flex-1 bg-[#f8fafc] border border-[#e2e8f0] rounded-md px-2 py-1 text-[11px] outline-none"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 px-2">
                <span className="text-[10px] text-[#94a3b8] w-8">To</span>
                <input
                  type="date"
                  className="flex-1 bg-[#f8fafc] border border-[#e2e8f0] rounded-md px-2 py-1 text-[11px] outline-none"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
