'use client';

import React from 'react';
import { X } from 'lucide-react';

export type ReportOrientationBannerProps = {
  userName?: string;
  added?: number;
  updated?: number;
  onDismiss: () => void;
};

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function ReportOrientationBanner({
  userName,
  added = 0,
  updated = 0,
  onDismiss,
}: ReportOrientationBannerProps) {
  const greeting = greetingForHour(new Date().getHours());
  const name = userName?.trim() || 'there';
  const hasDelta = added > 0 || updated > 0;
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} new call${added === 1 ? '' : 's'}`);
  if (updated > 0) parts.push(`${updated} updated`);

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-bg-soft px-4 py-2 text-[11px] text-slate-700">
      <p>
        <span className="font-medium text-slate-900">
          {greeting}, {name}.
        </span>{' '}
        {hasDelta ? (
          <>Since your last refresh: {parts.join(', ')}.</>
        ) : (
          <>Set filters and Apply to load the call register.</>
        )}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
