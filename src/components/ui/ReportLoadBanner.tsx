'use client';

import React from 'react';
import { Clock, Loader2 } from 'lucide-react';

export type ReportLoadStatus = {
  done: number;
  total: number;
  percent: number;
  currentRange?: string | null;
  etaRemainingLabel?: string | null;
  etaFinishLabel?: string | null;
  planMessage: string;
  rowsLoaded?: number;
  totalRows?: number;
  rowsProgressMode?: 'actual' | 'estimated';
  failedCount?: number;
};

export function formatReportDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'less than a minute';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'about 1 min' : `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (remMin === 0) return hours === 1 ? 'about 1 hr' : `about ${hours} hr`;
  return `about ${hours} hr ${remMin} min`;
}

export function formatReportFinishTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

type ReportLoadBannerProps = {
  status: ReportLoadStatus;
  variant?: 'loading' | 'preview' | 'export';
  title?: string;
  periodLabel?: string;
  previewApplyLabel?: string;
  exportHint?: string;
  footer?: React.ReactNode;
  className?: string;
};

const variantStyles = {
  loading: {
    wrap: 'border-slate-200 bg-bg-canvas text-slate-700',
    bar: 'bg-slate-100',
    fill: 'bg-slate-800',
    icon: 'text-slate-700',
    sub: 'text-slate-600',
    eta: 'text-slate-500',
  },
  preview: {
    wrap: 'border-amber-200 bg-amber-50 text-amber-900',
    bar: 'bg-amber-100',
    fill: 'bg-amber-500',
    icon: 'text-amber-600',
    sub: 'text-amber-900',
    eta: 'text-amber-800',
  },
  export: {
    wrap: 'border-blue-200 bg-blue-50 text-blue-900',
    bar: 'bg-blue-100',
    fill: 'bg-blue-700',
    icon: 'text-blue-700',
    sub: 'text-blue-900',
    eta: 'text-blue-800',
  },
} as const;

export function ReportLoadBanner({
  status,
  variant = 'loading',
  title,
  periodLabel = 'period',
  previewApplyLabel = 'Apply',
  exportHint,
  footer,
  className = '',
}: ReportLoadBannerProps) {
  const styles = variantStyles[variant];
  const isPreview = variant === 'preview';
  const isExport = variant === 'export';
  const showProgress = isPreview ? status.total > 1 : status.total >= 1;
  const resolvedTitle =
    title ??
    (isPreview ? 'Large date range selected' : isExport ? 'Export in progress…' : 'Loading data…');
  const periodPlural = status.total === 1 ? periodLabel : `${periodLabel}s`;
  const hasRowProgress = status.totalRows != null && status.totalRows > 0;
  const rowsProgressMode = status.rowsProgressMode ?? 'actual';
  // Export / row-driven loads should never show period/week/month counters.
  const showPeriodProgress = !isExport && !hasRowProgress;

  return (
    <div
      className={`mb-3 rounded-lg border px-3 py-3 text-[11px] ${styles.wrap} ${className}`.trim()}
    >
      <div className="flex items-start gap-2">
        {isPreview ? (
          <Clock className={`mt-0.5 h-4 w-4 shrink-0 ${styles.icon}`} />
        ) : (
          <Loader2 className={`mt-0.5 h-4 w-4 shrink-0 animate-spin ${styles.icon}`} />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[12px] text-slate-900">{resolvedTitle}</p>
          <p className={`mt-1 ${styles.sub}`}>{status.planMessage}</p>

          {showProgress ? (
            <div className="mt-3 space-y-2">
              {!isPreview ? (
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${styles.sub}`}>
                  <span className="font-medium text-slate-800">{status.percent}% complete</span>
                  <span>
                    {hasRowProgress
                      ? `${(status.rowsLoaded ?? 0).toLocaleString('en-IN')} of ${status.totalRows?.toLocaleString('en-IN')} rows loaded${
                          rowsProgressMode === 'estimated' ? ' (estimated)' : ''
                        }`
                      : showPeriodProgress
                        ? `${status.done} of ${status.total} ${periodPlural} loaded`
                        : `${(status.rowsLoaded ?? 0).toLocaleString('en-IN')} rows loaded`}
                    {status.failedCount ? ` · ${status.failedCount} timed out` : ''}
                  </span>
                  {status.currentRange ? (
                    <span>· {status.currentRange}</span>
                  ) : null}
                </div>
              ) : null}

              <div className={`h-2 overflow-hidden rounded-full ${styles.bar}`}>
                <div
                  className={`h-full rounded-full transition-all duration-300 ${styles.fill}`}
                  style={{ width: `${Math.max(isPreview ? 0 : 4, status.percent)}%` }}
                />
              </div>

              {!isPreview && status.etaRemainingLabel ? (
                <p className={styles.eta}>
                  {status.etaRemainingLabel} remaining
                  {status.etaFinishLabel ? ` · est. done by ${status.etaFinishLabel}` : ''}
                </p>
              ) : isPreview ? (
                <p className={styles.eta}>
                  Estimated load time: {status.etaRemainingLabel ?? 'a few minutes'} after you click{' '}
                  {previewApplyLabel}.
                </p>
              ) : null}

              {isExport && exportHint ? (
                <p className={`rounded-md px-2 py-1.5 ${styles.bar} ${styles.sub}`}>{exportHint}</p>
              ) : null}

              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
