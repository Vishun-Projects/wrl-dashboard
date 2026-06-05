'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { GLOSSARY, type GlossaryTermId } from '@/lib/ui/glossary';
import { cn } from '@/lib/cn';

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
