'use client';

import React from 'react';
import { repairSemantics } from '@/lib/ui/semantics';

export function SerialRepairLegend() {
  const items = [
    { label: 'Motor', className: repairSemantics.motor },
    { label: 'Compressor', className: repairSemantics.compressor },
    { label: 'Gas', className: repairSemantics.gas },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-600">
      <span className="font-medium text-slate-500">Repair tags:</span>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${item.className}`}>
            {item.label} 1
          </span>
          <span className="text-slate-500">{item.label} replacement count</span>
        </span>
      ))}
    </div>
  );
}
