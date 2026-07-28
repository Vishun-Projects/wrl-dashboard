'use client';

import React from 'react';

/** Matches sidebar header height so the top border lines up across the layout. */
export const DASHBOARD_HEADER_HEIGHT_CLASS = 'h-14';

type PageShellProps = {
  children: React.ReactNode;
  /** Filter bar or secondary controls directly under the header */
  toolbar?: React.ReactNode;
  /** Custom header row (tabs, etc.). When set, `title` / `actions` are ignored. */
  header?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  bodyClassName?: string;
};

export function PageShell({
  children,
  toolbar,
  header,
  title,
  subtitle,
  icon,
  actions,
  bodyClassName = 'flex-1 flex flex-col min-h-0 overflow-hidden bg-bg-soft',
}: PageShellProps) {
  const headerContent = header ?? (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-bg-soft text-slate-600 shadow-sm">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          {title ? <h1 className="ui-page-title truncate">{title}</h1> : null}
          {subtitle ? (
            <p className="ui-micro truncate">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-canvas text-slate-900">
      <header
        className={`${DASHBOARD_HEADER_HEIGHT_CLASS} flex flex-shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-bg-canvas px-4`}
      >
        {headerContent}
      </header>
      {toolbar}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

/** Scrollable main content below a fixed PageShell header/toolbar. */
export function PageScrollRegion({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-y-auto custom-scrollbar ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function PageLoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center bg-bg-canvas">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
      <p className="mt-3 ui-help">{label}</p>
    </div>
  );
}
