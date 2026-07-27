'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import {
  fadeSlideIn,
  instantTransition,
  motionTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

type ReportFetchingBarProps = {
  active: boolean;
  label?: string;
  /** Determinate progress 0–100; omit for indeterminate bar. */
  percent?: number;
};

/** Thin animated bar + label shown under filters while data is loading. */
export function ReportFetchingBar({
  active,
  label = 'Loading data…',
  percent,
}: ReportFetchingBarProps) {
  if (!active) return null;

  return (
    <div className="report-fetching-bar" role="status" aria-live="polite">
      <div className="report-fetching-bar-track">
        {percent != null && Number.isFinite(percent) ? (
          <div
            className="h-full rounded-full bg-slate-900 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(4, percent))}%` }}
          />
        ) : (
          <div className="report-fetching-bar-indicator" />
        )}
      </div>
      <p className="report-fetching-bar-label">
        <Loader2 size={12} className="animate-spin" />
        {label}
      </p>
    </div>
  );
}

type ReportProgressBarProps = {
  done: number;
  total: number;
  percent: number;
  label?: string;
  etaLabel?: string | null;
  failedCount?: number;
  className?: string;
};

/** Compact toolbar progress (done/total, mini bar, optional ETA). */
export function ReportProgressBar({
  done,
  total,
  percent,
  label,
  etaLabel,
  failedCount,
  className = '',
}: ReportProgressBarProps) {
  const resolvedLabel =
    label ?? `${done}/${total} ${total === 1 ? 'step' : 'steps'}${failedCount ? ` · ${failedCount} failed` : ''}`;

  return (
    <div className={`flex min-w-0 items-center gap-2 text-[10px] text-slate-500 ${className}`.trim()}>
      <span className="shrink-0 font-medium tabular-nums">{resolvedLabel}</span>
      {total > 0 ? (
        <span className="h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-slate-200">
          <span
            className="block h-full rounded-full bg-slate-800 transition-all duration-300"
            style={{ width: `${Math.max(percent, 4)}%` }}
          />
        </span>
      ) : null}
      {etaLabel ? <span className="hidden shrink-0 text-slate-400 md:inline">{etaLabel}</span> : null}
    </div>
  );
}

type ReportLoadingPanelProps = {
  label?: string;
  sublabel?: string;
  className?: string;
};

/** Centered loading state for main content areas. */
export function ReportLoadingPanel({
  label = 'Loading data…',
  sublabel,
  className = '',
}: ReportLoadingPanelProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <motion.div
      className={`report-loading-panel ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      variants={fadeSlideIn}
      initial="initial"
      animate="animate"
      transition={reducedMotion ? instantTransition() : motionTransition()}
    >
      <div className="report-loading-panel-spinner" />
      <p className="report-loading-panel-label">{label}</p>
      {sublabel ? <p className="report-loading-panel-sublabel">{sublabel}</p> : null}
    </motion.div>
  );
}

/** Matches Next.js report/loading.tsx layout for client mount hydration. */
export function ReportPageSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft animate-pulse ${className}`.trim()}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-14 flex-shrink-0 border-b border-slate-200 bg-bg-canvas" />
      <div className="flex-1 space-y-4 p-6">
        <div className="h-10 w-64 rounded-xl bg-slate-200/80" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 rounded-2xl bg-slate-200/60" />
          ))}
        </div>
        <div className="min-h-[320px] flex-1 rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}
