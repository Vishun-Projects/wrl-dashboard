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
  title?: string;
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
  bodyClassName = 'flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-50',
}: PageShellProps) {
  const headerContent = header ?? (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-600 shadow-sm">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          {title ? <h1 className="truncate text-xs text-slate-900 ui-label">{title}</h1> : null}
          {subtitle ? (
            <p className="truncate text-[10px] font-medium text-slate-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white text-slate-900">
      <header
        className={`${DASHBOARD_HEADER_HEIGHT_CLASS} flex flex-shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4`}
      >
        {headerContent}
      </header>
      {toolbar}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

export function PageLoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center bg-white">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
      <p className="mt-3 text-[11px] font-medium text-slate-500">{label}</p>
    </div>
  );
}
