'use client';

import React from 'react';
import { Tooltip } from './Tooltip';
import { Target, Clock, AlertTriangle } from 'lucide-react';

interface SummaryBarProps {
  totalCalls: number;
  unflaggedCount: number;
  escalationCount: number;
}

export function SummaryBar({ totalCalls, unflaggedCount, escalationCount }: SummaryBarProps) {
  const progress = totalCalls > 0 ? ((totalCalls - unflaggedCount) / totalCalls) * 100 : 0;
  
  return (
    <div className="h-10 bg-white/40 backdrop-blur-md border-b border-slate-200/60 flex items-center justify-between px-6">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <Target size={14} className="text-slate-400" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Batch</span>
            <span className="text-[12px] font-black text-slate-900">{totalCalls}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Clock size={14} className="text-slate-400" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending Review</span>
            <span className="text-[12px] font-black text-slate-900">{unflaggedCount}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-8">
        {escalationCount > 0 && (
          <div className="flex items-center gap-3">
            <AlertTriangle size={14} className="text-rose-500" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">High Priority</span>
              <span className="text-[12px] font-black text-rose-600">{escalationCount}</span>
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-4">
           <Tooltip content={`${Math.round(progress)}% Processed`}>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Review Progress</span>
              <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                <div 
                  className="h-full bg-slate-900 transition-all duration-1000 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[11px] font-black text-slate-900 tabular-nums">{Math.round(progress)}%</span>
            </div>
           </Tooltip>
        </div>
      </div>
    </div>
  );
}
