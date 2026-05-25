'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

type ReportFetchingBarProps = {
  active: boolean;
  label?: string;
};

/** Thin animated bar + label shown under filters while data is loading. */
export function ReportFetchingBar({
  active,
  label = 'Loading data…',
}: ReportFetchingBarProps) {
  if (!active) return null;

  return (
    <div className="report-fetching-bar" role="status" aria-live="polite">
      <div className="report-fetching-bar-track">
        <div className="report-fetching-bar-indicator" />
      </div>
      <p className="report-fetching-bar-label">
        <Loader2 size={12} className="animate-spin" />
        {label}
      </p>
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
  return (
    <div
      className={`report-loading-panel ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="report-loading-panel-spinner" />
      <p className="report-loading-panel-label">{label}</p>
      {sublabel ? <p className="report-loading-panel-sublabel">{sublabel}</p> : null}
    </div>
  );
}

type ReportLoadingOverlayProps = {
  active: boolean;
  label?: string;
  children: React.ReactNode;
};

/** Overlays children with a semi-transparent loading layer. */
export function ReportLoadingOverlay({
  active,
  label = 'Loading…',
  children,
}: ReportLoadingOverlayProps) {
  return (
    <div className="relative min-h-0 flex-1">
      {children}
      {active ? (
        <div className="report-loading-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="report-loading-panel-spinner" />
          <p className="report-loading-panel-label">{label}</p>
        </div>
      ) : null}
    </div>
  );
}
