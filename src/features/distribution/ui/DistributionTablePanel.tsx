'use client';

import React from 'react';
import { CheckCircle } from 'lucide-react';
import { SortIndicator } from '@/components/ui/SortableTh';

export type DistributionTableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  className?: string;
  width?: string;
};

type DistributionTablePanelProps = {
  title: string;
  subtitle: string;
  count: number;
  /** Shown beside count when tables are linked (e.g. "3 linked") */
  countNote?: string;
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  isEmpty?: boolean;
  sortField?: string;
  sortAsc?: boolean;
  onSort?: (field: string) => void;
  columns: DistributionTableColumn[];
  children: React.ReactNode;
  footerHint?: string;
  panelClassName?: string;
  tableMinWidth?: string;
};

export function DistributionTablePanel({
  title,
  subtitle,
  count,
  countNote,
  loading = false,
  loadingMessage = 'Loading…',
  emptyMessage = 'No rows match the current filters.',
  isEmpty = false,
  sortField,
  sortAsc = false,
  onSort,
  columns,
  children,
  footerHint,
  panelClassName = '',
  tableMinWidth = '36rem',
}: DistributionTablePanelProps) {
  const showEmpty = !loading && isEmpty;
  const showTable = !loading && !isEmpty;

  return (
    <div className={`distribution-table-panel ${panelClassName}`.trim()}>
      <div className="distribution-table-panel__header">
        <div className="min-w-0">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900">{title}</h3>
          <p className="truncate text-[10px] text-slate-500">{subtitle}</p>
        </div>
        <span className="distribution-table-panel__count" title={`${count} rows${countNote ? ` · ${countNote}` : ''}`}>
          {count.toLocaleString()}
          {countNote ? (
            <span className="ml-1 font-medium text-teal-700">{countNote}</span>
          ) : null}
        </span>
      </div>

      <div className="distribution-table-panel__body custom-scrollbar">
        {loading ? (
          <div className="distribution-table-panel__overlay">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
            <p className="text-xs font-semibold tracking-wide text-slate-600 animate-pulse">{loadingMessage}</p>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="distribution-table-panel__empty">
            <CheckCircle size={22} className="text-teal-600" />
            <p className="text-xs font-semibold text-slate-500">{emptyMessage}</p>
          </div>
        ) : null}

        {showTable ? (
          <div className="distribution-data-table-scroll" style={{ minWidth: tableMinWidth }}>
            <table className="distribution-data-table">
              <colgroup>
                {columns.map((col) => (
                  <col key={col.key} style={col.width ? { width: col.width } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((col) => {
                    const align =
                      col.align === 'center'
                        ? 'text-center'
                        : col.align === 'right'
                          ? 'text-right'
                          : 'text-left';
                    const sortable = col.sortable && onSort;
                    return (
                      <th
                        key={col.key}
                        className={`${align} ${col.className ?? ''} ${sortable ? 'distribution-data-table__th--sortable table-th-sortable' : ''}`}
                        onClick={sortable ? () => onSort(col.key) : undefined}
                        title={sortable ? 'Click to sort' : undefined}
                      >
                        <div
                          className={`flex items-center gap-1 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''}`}
                        >
                          <span className="ui-field-label text-slate-700">{col.label}</span>
                          {sortable ? (
                            <SortIndicator
                              active={sortField === col.key}
                              dir={sortAsc ? 'asc' : 'desc'}
                            />
                          ) : null}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">{children}</tbody>
            </table>
          </div>
        ) : null}
      </div>

      {footerHint ? (
        <p className="mt-1.5 shrink-0 text-[9px] text-slate-400">{footerHint}</p>
      ) : null}
    </div>
  );
}

export function DistributionIssueBadge({ issue }: { issue: 'assigned_no_completions' | 'zero_allocations' }) {
  if (issue === 'assigned_no_completions') {
    return (
      <span className="distribution-status-badge distribution-status-badge--warn">No completions</span>
    );
  }
  return <span className="distribution-status-badge distribution-status-badge--muted">Zero allocations</span>;
}

export function DistributionLoadBadge({
  ratio,
}: {
  ratio: number;
}) {
  if (ratio > 15) {
    return <span className="distribution-status-badge distribution-status-badge--critical">Critical skew</span>;
  }
  if (ratio > 7) {
    return <span className="distribution-status-badge distribution-status-badge--warn">Overallocated</span>;
  }
  return <span className="distribution-status-badge distribution-status-badge--ok">Balanced</span>;
}
