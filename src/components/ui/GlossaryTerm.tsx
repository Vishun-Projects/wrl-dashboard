'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type GlossaryTermId = 'ARCP' | 'BM' | 'ASP' | 'HOD' | 'FRN';

const GLOSSARY: Record<GlossaryTermId, { label: string; definition: string }> = {
  ARCP: {
    label: 'ARCP',
    definition: 'Approved claim lines synced from CRM for reimbursement reporting.',
  },
  BM: {
    label: 'BM',
    definition: 'Branch Manager — approval stage before HO / finance processing.',
  },
  ASP: {
    label: 'ASP',
    definition: 'Authorized Service Partner (franchisee) handling the service call.',
  },
  HOD: {
    label: 'HOD',
    definition: 'Head of Department — HO-level approval on selected claim lines.',
  },
  FRN: {
    label: 'FRN',
    definition: 'Franchisee code identifying the ASP in CRM.',
  },
};

export type GlossaryTermProps = {
  term: GlossaryTermId;
  className?: string;
  showIcon?: boolean;
};

export function GlossaryTerm({ term, className, showIcon = true }: GlossaryTermProps) {
  const entry = GLOSSARY[term];
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      title={entry.definition}
    >
      <span>{entry.label}</span>
      {showIcon ? (
        <HelpCircle className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
      ) : null}
      <span className="sr-only">{entry.definition}</span>
    </span>
  );
}
