'use client';

import React from 'react';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Check,
} from 'lucide-react';
import type { AthenaReconciliationKpis } from '../types';

interface AthenaKpiCardsProps {
  kpis: AthenaReconciliationKpis;
  activeStatus?: string | null;
  onSelectStatus?: (status: string) => void;
}

export function AthenaKpiCards({
  kpis,
  activeStatus = 'ALL',
  onSelectStatus,
}: AthenaKpiCardsProps) {
  const currentStatus = activeStatus || 'ALL';

  const cards = [
    {
      id: 'ALL',
      label: 'All Failed Calls',
      value: kpis.totalRecords.toLocaleString(),
      detail: 'Total raw CRM ingestion failures',
      icon: FileText,
      activeBorder: 'border-slate-900 bg-slate-950 text-white dark:border-blue-500 dark:bg-blue-950/40 dark:text-white',
      inactiveBorder: 'border-slate-200 bg-white hover:border-slate-300 text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:border-slate-700',
      badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      iconColor: 'text-slate-500 dark:text-slate-400',
    },
    {
      id: 'REGISTERED',
      label: 'Subsequently Registered',
      value: kpis.registered.toLocaleString(),
      detail: `${kpis.registrationRatePct}% Registered in CRM`,
      icon: CheckCircle2,
      activeBorder: 'border-teal-700 bg-teal-900 text-white dark:border-teal-500 dark:bg-teal-950/60 dark:text-white',
      inactiveBorder: 'border-slate-200 bg-white hover:border-teal-300 text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:border-teal-800',
      badgeClass: 'bg-teal-50 text-teal-800 border border-teal-200/80 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/60',
      iconColor: 'text-teal-600 dark:text-teal-400',
    },
    {
      id: 'NOT_REGISTERED',
      label: 'Unregistered Failures',
      value: kpis.notRegistered.toLocaleString(),
      detail: `${kpis.failureRatePct}% true net failures`,
      icon: AlertTriangle,
      activeBorder: 'border-rose-700 bg-rose-950 text-white dark:border-rose-500 dark:bg-rose-950/60 dark:text-white',
      inactiveBorder: 'border-slate-200 bg-white hover:border-rose-300 text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:border-rose-800',
      badgeClass: 'bg-rose-50 text-rose-800 border border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60',
      iconColor: 'text-rose-600 dark:text-rose-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 w-full">
      {cards.map((card) => {
        const Icon = card.icon;
        const isSelected = currentStatus === card.id;

        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectStatus?.(card.id)}
            className={`group relative flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all duration-150 shadow-2xs ${
              isSelected ? card.activeBorder : card.inactiveBorder
            }`}
          >
            <div className="flex items-center justify-between gap-1.5 w-full">
              <span className={`text-[11px] font-medium truncate ${isSelected ? 'text-white/90' : 'text-slate-500 dark:text-slate-400'}`}>
                {card.label}
              </span>
              <Icon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-white' : card.iconColor}`} />
            </div>

            <div className="my-1 flex items-baseline justify-between gap-2">
              <span className={`text-xl font-bold tracking-tight ${isSelected ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                {card.value}
              </span>
              {isSelected && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-white/90">
                  <Check className="h-3 w-3" /> Active
                </span>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-black/5 dark:border-white/10 pt-1 text-[10px]">
              <span className={`truncate ${isSelected ? 'text-white/80' : 'text-slate-400 dark:text-slate-400'}`}>
                {card.detail}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
