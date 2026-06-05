'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type LoadingStateProps = {
  message?: string;
  submessage?: string;
  progress?: number;
  className?: string;
  compact?: boolean;
};

export function LoadingState({
  message = 'Loading…',
  submessage,
  progress,
  className,
  compact = false,
}: LoadingStateProps) {
  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 text-[11px] text-slate-600', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className={cn('report-loading-panel', className)}>
      <Loader2 className="report-loading-panel-spinner" />
      <p className="report-loading-panel-label">{message}</p>
      {submessage ? <p className="report-loading-panel-sublabel">{submessage}</p> : null}
      {typeof progress === 'number' ? (
        <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
