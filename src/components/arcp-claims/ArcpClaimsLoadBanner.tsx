'use client';

import React from 'react';
import { Clock, Loader2 } from 'lucide-react';

export type ArcpLoadStatus = {
  done: number;
  total: number;
  percent: number;
  currentRange: string | null;
  etaRemainingLabel: string | null;
  etaFinishLabel: string | null;
  planMessage: string;
  rowsLoaded?: number;
  failedCount?: number;
};

export function formatArcpDurationMs(ms: number): string {
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

export function formatArcpFinishTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format rupee totals in crore for progress display (en-IN). */
export function formatArcpCrore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '₹0';
  const crore = value / 10_000_000;
  if (crore >= 1) {
    return `₹${crore.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  }
  const lakh = value / 100_000;
  return `₹${lakh.toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
}

export type ArcpRunningTotals = {
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

type ArcpClaimsInlineProgressProps = {
  status: ArcpLoadStatus;
  periodUnit?: string;
};

/** Compact progress — toolbar and above tables during multi- or single-chunk loads. */
export function ArcpClaimsInlineProgress({
  status,
  periodUnit = 'periods',
}: ArcpClaimsInlineProgressProps) {
  const inFlight = status.done < status.total;
  const barPercent =
    status.total <= 1 && inFlight ? 8 : Math.max(status.percent, inFlight ? 4 : 0);

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500"
      aria-live="polite"
    >
      <span className="tabular-nums font-medium text-slate-600">
        {status.done}/{status.total} {periodUnit}
        {status.failedCount ? ` (${status.failedCount} timed out)` : ''}
      </span>
      <div className="h-1.5 w-20 min-w-[4rem] overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full bg-slate-700 transition-all duration-300 ${
            status.total <= 1 && inFlight ? 'animate-pulse' : ''
          }`}
          style={{ width: `${barPercent}%` }}
        />
      </div>
      {status.rowsLoaded != null && status.rowsLoaded > 0 ? (
        <span className="text-slate-500">
          {status.rowsLoaded.toLocaleString('en-IN')} lines in tally
        </span>
      ) : null}
      {inFlight && status.etaRemainingLabel ? (
        <span className="text-slate-400">{status.etaRemainingLabel}</span>
      ) : null}
    </div>
  );
}

type ArcpClaimsLoadBannerProps = {
  status: ArcpLoadStatus;
  variant?: 'loading' | 'preview' | 'detail-export';
  runningTotals?: ArcpRunningTotals | null;
};

export function ArcpClaimsLoadBanner({
  status,
  variant = 'loading',
  runningTotals,
}: ArcpClaimsLoadBannerProps) {
  const isPreview = variant === 'preview';
  const isDetailExport = variant === 'detail-export';
  const showProgress = status.total > 1;
  const title = isPreview
    ? 'Large date range selected'
    : isDetailExport
      ? 'Exporting detail CSV…'
      : 'Loading ARCP tally…';

  return (
    <div
      className={`mb-3 rounded-lg border px-3 py-3 text-[11px] ${
        isPreview
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : isDetailExport
            ? 'border-blue-200 bg-blue-50 text-blue-900'
            : 'border-slate-200 bg-white text-slate-700'
      }`}
    >
      <div className="flex items-start gap-2">
        {isPreview ? (
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <Loader2
            className={`mt-0.5 h-4 w-4 shrink-0 animate-spin ${
              isDetailExport ? 'text-blue-700' : 'text-slate-700'
            }`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[12px] text-slate-900">{title}</p>
          <p className={`mt-1 ${isDetailExport ? 'text-blue-900' : 'text-slate-600'}`}>
            {status.planMessage}
          </p>

          {showProgress ? (
            <div className="mt-3 space-y-2">
              {!isPreview ? (
                <div
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${
                    isDetailExport ? 'text-blue-900' : 'text-slate-600'
                  }`}
                >
                  <span className="font-medium text-slate-800">{status.percent}% complete</span>
                  <span>
                    {status.done} of {status.total} period{status.total === 1 ? '' : 's'} complete
                  </span>
                  {status.currentRange ? <span>({status.currentRange})</span> : null}
                  {status.rowsLoaded != null ? (
                    <span>{status.rowsLoaded.toLocaleString('en-IN')} lines in tally so far</span>
                  ) : null}
                </div>
              ) : null}

              <div className={`h-2 overflow-hidden rounded-full ${isDetailExport ? 'bg-blue-100' : 'bg-slate-100'}`}>
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isPreview ? 'bg-amber-500' : isDetailExport ? 'bg-blue-700' : 'bg-slate-800'
                  }`}
                  style={{ width: `${Math.max(isPreview ? 0 : 4, status.percent)}%` }}
                />
              </div>

              {!isPreview && status.etaRemainingLabel ? (
                <p className={isDetailExport ? 'text-blue-800' : 'text-slate-500'}>
                  {status.etaRemainingLabel} remaining
                  {status.etaFinishLabel ? ` · est. done by ${status.etaFinishLabel}` : ''}
                </p>
              ) : isPreview ? (
                <p className="text-amber-800">
                  Estimated load time: {status.etaRemainingLabel ?? 'a few minutes'} after you click Apply
                  Filter.
                </p>
              ) : null}

              {isDetailExport ? (
                <p className="rounded-md bg-blue-100/60 px-2 py-1.5 text-blue-900">
                  Full-year detail export can take several minutes. The CSV downloads automatically when all
                  periods finish — please keep this tab open.
                </p>
              ) : null}

              {!isPreview &&
              !isDetailExport &&
              runningTotals &&
              (runningTotals.amountPayable > 0 || runningTotals.branchApproved > 0) ? (
                <p className="rounded-md bg-slate-50 px-2 py-1.5 text-slate-600">
                  Cumulative tally so far: {formatArcpCrore(runningTotals.amountPayable)} payable
                  {runningTotals.branchApproved > 0
                    ? ` · ${formatArcpCrore(runningTotals.branchApproved)} branch approved`
                    : ''}
                  .
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
