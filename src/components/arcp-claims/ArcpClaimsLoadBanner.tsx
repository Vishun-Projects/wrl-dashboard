'use client';

import React from 'react';
import {
  ReportLoadBanner,
  formatReportDurationMs,
  formatReportFinishTime,
  type ReportLoadStatus,
} from '@/components/ui/ReportLoadBanner';

export type ArcpLoadStatus = ReportLoadStatus;

export const formatArcpDurationMs = formatReportDurationMs;
export const formatArcpFinishTime = formatReportFinishTime;

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
  const reportVariant = variant === 'detail-export' ? 'export' : variant;
  const isDetailExport = variant === 'detail-export';

  const footer =
    reportVariant === 'loading' || isDetailExport
      ? runningTotals &&
        (runningTotals.amountPayable > 0 ||
          runningTotals.branchApproved > 0 ||
          runningTotals.hoApproved > 0) ? (
          <p
            className={`rounded-md px-2 py-1.5 ${
              isDetailExport ? 'bg-blue-100/60 text-blue-900' : 'bg-slate-50 text-slate-600'
            }`}
          >
            {isDetailExport ? 'Detail export tally so far' : 'Cumulative tally so far'}:{' '}
            {formatArcpCrore(runningTotals.amountPayable)} payable
            {runningTotals.branchApproved > 0
              ? ` · ${formatArcpCrore(runningTotals.branchApproved)} branch approved`
              : ''}
            .
          </p>
        ) : null
      : null;

  return (
    <ReportLoadBanner
      status={status}
      variant={reportVariant}
      title={
        variant === 'preview'
          ? 'Large date range selected'
          : isDetailExport
            ? 'Exporting detail CSV…'
            : 'Loading ARCP tally…'
      }
      periodLabel="period"
      previewApplyLabel="Apply filters"
      exportHint={
        isDetailExport
          ? 'Full-year detail export can take several minutes. The CSV downloads automatically when all periods finish — please keep this tab open.'
          : undefined
      }
      footer={footer}
    />
  );
}
