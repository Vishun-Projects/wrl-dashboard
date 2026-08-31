'use client';

import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Copy,
  FileQuestion,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { TrnLink } from '@/components/calls/TrnLink';
import { formatUiDateDash } from '@/lib/dates/ui-date';
import type { AthenaFailedNormalizedRow, AthenaReconciliationStatus } from '../types';

interface AthenaDataTableProps {
  rows: AthenaFailedNormalizedRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newSize: number) => void;
  onSortChange: (column: string) => void;
  onViewDetail: (row: AthenaFailedNormalizedRow) => void;
}

export function AthenaDataTable({
  rows,
  total,
  page,
  pageSize,
  totalPages,
  isLoading,
  sortBy,
  sortDir,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onViewDetail,
}: AthenaDataTableProps) {
  const getStatusBadge = (status: AthenaReconciliationStatus) => {
    switch (status) {
      case 'REGISTERED':
        return (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200/80 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/60">
            <CheckCircle2 className="h-2.5 w-2.5" /> Registered
          </span>
        );
      case 'NOT_REGISTERED':
        return (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-rose-50 text-rose-800 border border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60">
            <AlertTriangle className="h-2.5 w-2.5" /> Unregistered
          </span>
        );
      case 'MULTIPLE_MATCHES':
        return (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-50 text-violet-800 border border-violet-200/80 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800/60">
            <Copy className="h-2.5 w-2.5" /> Multiple
          </span>
        );
      case 'INVALID_DATA':
        return (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60">
            <FileQuestion className="h-2.5 w-2.5" /> Invalid
          </span>
        );
    }
  };

  const renderSortIcon = (colName: string) => {
    if (sortBy !== colName) {
      return <ArrowUpDown className="h-2.5 w-2.5 text-slate-300 group-hover:text-slate-500" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-2.5 w-2.5 text-blue-600 dark:text-blue-400" />
    ) : (
      <ArrowDown className="h-2.5 w-2.5 text-blue-600 dark:text-blue-400" />
    );
  };

  const formatDate = (d: Date | string | null) => {
    if (!d) return '-';
    const formatted = formatUiDateDash(d);
    return formatted || String(d);
  };

  const hasAnyMatch = rows.some((r) => Boolean(r.matchedVtrnno));

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900/70">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-600 dark:border-slate-800 dark:bg-slate-850 dark:text-slate-300 select-none">
            <tr>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 whitespace-nowrap text-[11px]"
                onClick={() => onSortChange('callDate')}
              >
                <div className="flex items-center gap-1">
                  Call Date {renderSortIcon('callDate')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 whitespace-nowrap text-[11px]"
                onClick={() => onSortChange('clientCaption')}
              >
                <div className="flex items-center gap-1">
                  Client / Brand {renderSortIcon('clientCaption')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 whitespace-nowrap text-[11px]"
                onClick={() => onSortChange('branchName')}
              >
                <div className="flex items-center gap-1">
                  Branch {renderSortIcon('branchName')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 whitespace-nowrap text-[11px]"
                onClick={() => onSortChange('clientTicketNo')}
              >
                <div className="flex items-center gap-1">
                  Ticket No {renderSortIcon('clientTicketNo')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 whitespace-nowrap text-[11px]"
                onClick={() => onSortChange('callType')}
              >
                <div className="flex items-center gap-1">
                  Call Type {renderSortIcon('callType')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 text-[11px]"
                onClick={() => onSortChange('outletName')}
              >
                <div className="flex items-center gap-1">
                  Outlet Name {renderSortIcon('outletName')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 whitespace-nowrap text-[11px]"
                onClick={() => onSortChange('serialNo')}
              >
                <div className="flex items-center gap-1">
                  Serial No {renderSortIcon('serialNo')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 text-[11px]"
                onClick={() => onSortChange('failureReason')}
              >
                <div className="flex items-center gap-1">
                  Failure Reason {renderSortIcon('failureReason')}
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-2 font-semibold group hover:bg-slate-100/60 dark:hover:bg-slate-800 whitespace-nowrap text-[11px]"
                onClick={() => onSortChange('reconciliationStatus')}
              >
                <div className="flex items-center gap-1">
                  Status {renderSortIcon('reconciliationStatus')}
                </div>
              </th>
              {hasAnyMatch && (
                <th className="px-2.5 py-2 font-semibold whitespace-nowrap text-[11px]">Matched CRM Call</th>
              )}
              <th className="px-2.5 py-2 font-semibold text-right whitespace-nowrap text-[11px]">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: hasAnyMatch ? 11 : 10 }).map((_, j) => (
                    <td key={j} className="px-2.5 py-2">
                      <div className="h-3.5 w-full rounded bg-slate-100 dark:bg-slate-800" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={hasAnyMatch ? 11 : 10} className="py-8 text-center text-xs text-slate-400">
                  No failed calls found matching your filter criteria.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-slate-900 dark:text-white">
                    {formatDate(row.callDate)}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-300">
                    {row.clientCaption || '-'}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                    {row.branchName || '-'}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1">
                      <span>{row.clientTicketNo || '-'}</span>
                      {row.attemptCount && row.attemptCount > 1 ? (
                        <span
                          className="rounded bg-amber-50 px-1 py-0.2 text-[9px] font-bold text-amber-700 border border-amber-200/60 dark:bg-amber-950/50 dark:text-amber-300 whitespace-nowrap"
                          title={`${row.attemptCount} repeated failure logs recorded in CRM`}
                        >
                          {row.attemptCount} logs
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {row.callType || '-'}
                  </td>
                  <td className="px-2.5 py-1.5 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[160px]">
                    {row.outletName || '-'}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono font-semibold text-slate-900 dark:text-white">
                    {row.serialNo || '-'}
                  </td>
                  <td className="px-2.5 py-1.5 text-rose-600 dark:text-rose-400 font-medium truncate max-w-[160px]">
                    {row.failureReason || '-'}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    {getStatusBadge(row.reconciliationStatus)}
                  </td>
                  {hasAnyMatch && (
                    <td className="whitespace-nowrap px-2.5 py-1.5">
                      {row.matchedVtrnno ? (
                        <div className="flex items-center gap-1">
                          <TrnLink
                            trn={row.matchedVtrnno}
                            className="font-mono font-semibold text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {row.matchedVtrnno}
                          </TrnLink>
                          {row.matchCount > 1 && (
                            <span className="rounded bg-violet-100 px-1 py-0.1 text-[9px] font-bold text-violet-700 dark:bg-violet-900/60 dark:text-violet-300">
                              +{row.matchCount - 1}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onViewDetail(row)}
                      className="inline-flex items-center rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 shadow-2xs"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* High-density Pagination bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-[11px]">
          <span>
            Showing <strong className="text-slate-800 dark:text-slate-200">{rows.length > 0 ? (page - 1) * pageSize + 1 : 0}</strong> to{' '}
            <strong className="text-slate-800 dark:text-slate-200">
              {Math.min(page * pageSize, total)}
            </strong>{' '}
            of <strong className="text-slate-800 dark:text-slate-200">{total.toLocaleString()}</strong> calls
          </span>

          <span className="text-slate-300 dark:text-slate-700">•</span>

          <div className="flex items-center gap-1">
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Page navigation controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1 || isLoading}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <ChevronLeft className="h-3 w-3" /> Prev
          </button>
          <span className="px-2 text-[11px] text-slate-500 dark:text-slate-400">
            {page} / {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || isLoading}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Next <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
