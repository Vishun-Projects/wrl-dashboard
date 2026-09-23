'use client';

import React from 'react';
import { ShieldAlert, ShieldCheck, PhoneCall, Cpu, AlertTriangle } from 'lucide-react';
import type { WarrantyComparisonSummary } from '../types';

type KpiProps = {
  summary: WarrantyComparisonSummary | null;
  loading: boolean;
};

export function WarrantyComparisonKpiCards({ summary, loading }: KpiProps) {
  const totalCalls = summary?.totalCallsAnalyzed ?? 0;
  const withMaster = summary?.totalWithWarrantyMaster ?? 0;
  const oowInWarr = summary?.oowInWarrCount ?? 0;
  const inWarrOow = summary?.inWarrOowCount ?? 0;
  const uniqueSerials = summary?.uniqueSerialsCount ?? 0;

  const oowRate = withMaster > 0 ? ((oowInWarr / withMaster) * 100).toFixed(1) : '0';
  const inWarrRate = withMaster > 0 ? ((inWarrOow / withMaster) * 100).toFixed(1) : '0';

  return (
    <div className="grid grid-cols-2 gap-2 px-3 py-1.5 sm:grid-cols-4 lg:grid-cols-4">
      {/* 1. Total Calls */}
      <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
          <span>Calls Analyzed</span>
          <PhoneCall className="h-3.5 w-3.5 text-slate-400" />
        </div>
        <div className="mt-0.5 text-base font-bold text-slate-900 sm:text-lg">
          {loading ? '…' : totalCalls.toLocaleString()}
        </div>
        <div className="mt-0.5 text-[10px] text-slate-400 truncate">
          {loading ? '' : `${withMaster.toLocaleString()} matched with master`}
        </div>
      </div>

      {/* 2. OOW in Master, but In-Warranty in Call (High Risk) */}
      <div className="rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 py-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] text-rose-700 font-medium">
          <span>OOW in Master → In Warr</span>
          <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
        </div>
        <div className="mt-0.5 text-base font-bold text-rose-700 sm:text-lg">
          {loading ? '…' : oowInWarr.toLocaleString()}
        </div>
        <div className="mt-0.5 text-[10px] text-rose-600 font-medium truncate">
          {loading ? '' : `${oowRate}% of matched calls`}
        </div>
      </div>

      {/* 3. In-Warranty in Master, but OOW in Call */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] text-amber-800 font-medium">
          <span>In Warr in Master → OOW</span>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        </div>
        <div className="mt-0.5 text-base font-bold text-amber-800 sm:text-lg">
          {loading ? '…' : inWarrOow.toLocaleString()}
        </div>
        <div className="mt-0.5 text-[10px] text-amber-700 font-medium truncate">
          {loading ? '' : `${inWarrRate}% of matched calls`}
        </div>
      </div>

      {/* 4. Total Discrepancies */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 px-2.5 py-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] text-indigo-700 font-medium">
          <span>Total Mismatches</span>
          <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
        </div>
        <div className="mt-0.5 text-base font-bold text-indigo-900 sm:text-lg">
          {loading ? '…' : (oowInWarr + inWarrOow).toLocaleString()}
        </div>
        <div className="mt-0.5 text-[10px] text-indigo-600 truncate">
          {loading ? '' : 'Warranty status conflict'}
        </div>
      </div>
    </div>
  );
}
