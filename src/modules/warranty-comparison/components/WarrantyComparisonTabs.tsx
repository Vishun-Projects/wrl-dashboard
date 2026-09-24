'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, Layers, ShieldCheck } from 'lucide-react';
import type { WarrantyComparisonSummary, WarrantyComparisonTab } from '../types';

type TabsProps = {
  activeTab: WarrantyComparisonTab;
  onTabChange: (tab: WarrantyComparisonTab) => void;
  summary: WarrantyComparisonSummary | null;
  loading: boolean;
};

export function WarrantyComparisonTabs({
  activeTab,
  onTabChange,
  summary,
  loading,
}: TabsProps) {
  const oowInWarrCount = summary?.oowInWarrCount ?? 0;
  const inWarrOowCount = summary?.inWarrOowCount ?? 0;
  const exceptionOkCount = summary?.exceptionOkCount ?? 0;
  const totalMismatches = oowInWarrCount + inWarrOowCount;

  return (
    <div className="border-b border-slate-200 bg-white px-3 overflow-x-auto">
      <nav className="-mb-px flex space-x-4 min-w-max" aria-label="Tabs">
        {/* Tab 1: Out of warranty in master, but in-warranty in call register */}
        <button
          type="button"
          onClick={() => onTabChange('oow_in_warr')}
          className={`group inline-flex items-center gap-1.5 border-b-2 py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'oow_in_warr'
              ? 'border-rose-600 text-rose-700 font-semibold'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          <AlertCircle
            className={`h-3.5 w-3.5 shrink-0 ${
              activeTab === 'oow_in_warr' ? 'text-rose-600' : 'text-slate-400 group-hover:text-slate-500'
            }`}
          />
          <span>Machines Under Out of Warranty but Call register in warranty</span>
          <span
            className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
              activeTab === 'oow_in_warr'
                ? 'bg-rose-100 text-rose-800'
                : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
            }`}
          >
            {loading ? '…' : oowInWarrCount.toLocaleString()}
          </span>
        </button>

        {/* Tab 2: In warranty in master, but out-of-warranty in call register */}
        <button
          type="button"
          onClick={() => onTabChange('in_warr_oow')}
          className={`group inline-flex items-center gap-1.5 border-b-2 py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'in_warr_oow'
              ? 'border-amber-600 text-amber-700 font-semibold'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          <AlertTriangle
            className={`h-3.5 w-3.5 shrink-0 ${
              activeTab === 'in_warr_oow' ? 'text-amber-600' : 'text-slate-400 group-hover:text-slate-500'
            }`}
          />
          <span>Machines Under in warranty but Call register as out of warranty</span>
          <span
            className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
              activeTab === 'in_warr_oow'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
            }`}
          >
            {loading ? '…' : inWarrOowCount.toLocaleString()}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('exception_ok')}
          className={`group inline-flex items-center gap-1.5 border-b-2 py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'exception_ok'
              ? 'border-emerald-600 text-emerald-700 font-semibold'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          <ShieldCheck
            className={`h-3.5 w-3.5 shrink-0 ${
              activeTab === 'exception_ok' ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-500'
            }`}
          />
          <span>AMC / Compressor</span>
          <span
            className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
              activeTab === 'exception_ok'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
            }`}
          >
            {loading ? '…' : exceptionOkCount.toLocaleString()}
          </span>
        </button>

        {/* Tab 3: All Mismatches */}
        <button
          type="button"
          onClick={() => onTabChange('all')}
          className={`group inline-flex items-center gap-1.5 border-b-2 py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'all'
              ? 'border-blue-600 text-blue-700 font-semibold'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          <Layers
            className={`h-3.5 w-3.5 shrink-0 ${
              activeTab === 'all' ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-500'
            }`}
          />
          <span>All Discrepancies</span>
          <span
            className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
              activeTab === 'all'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
            }`}
          >
            {loading ? '…' : totalMismatches.toLocaleString()}
          </span>
        </button>
      </nav>
    </div>
  );
}
