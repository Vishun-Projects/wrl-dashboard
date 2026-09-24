'use client';

import React from 'react';
import {
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { TrnLink } from '@/components/calls/TrnLink';
import { TableSkeleton } from '@/components/ui/DataTableLoading';
import { formatUiDateDash } from '@/lib/dates/ui-date';
import { ChevronLeft, ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { WarrantyComparisonRow } from '../types';

type TableProps = {
  rows: WarrantyComparisonRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newSize: number) => void;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (column: any) => void;
  loading: boolean;
};

function dashDate(value: string | null | undefined): string {
  return formatUiDateDash(value) || '—';
}

function statusTextClass(status: string): string {
  const key = status.trim().toLowerCase();
  if (key === 'assigned') return 'text-pink-400';
  if (key === 'cancelled' || key === 'canceled') return 'text-red-600';
  if (key === 'closed') return 'text-green-800';
  if (key === 'open unallocated') return 'text-yellow-500';
  if (key === 'tech. solve call' || key === 'tech solve call') return 'text-green-400';
  return 'text-slate-500';
}

export function WarrantyComparisonTable({
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortDir,
  onSortChange,
  loading,
}: TableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 bg-white">
      <AdminTableCard isEmpty={!loading && rows.length === 0}>
        {loading ? (
          <TableSkeleton columns={11} rows={10} />
        ) : (
          <AdminTable className="w-full min-w-[1240px] border-collapse text-left">
            <AdminThead>
              <AdminTr className="bg-slate-50 text-[11px] font-semibold text-slate-600 border-b border-slate-200">
                <AdminTh
                  sortable
                  sortKey="vtrnno"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Call No
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="callDate"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Call Date
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="serial"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Serial No
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="partyName"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Customer / Branch
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="account"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Account as per CRM
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="customerSubgroup"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Account as per System
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="billingDoc"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Invoice Number
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="warrEndDt"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2"
                >
                  Master Warranty End
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="warrantyMonths"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  align="center"
                  className="!py-1.5 !px-2 whitespace-nowrap"
                >
                  Warranty Months
                </AdminTh>
                <AdminTh align="center" className="!py-1.5 !px-2 whitespace-nowrap">
                  Warranty as per Call (WCO)
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="daysDelta"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  align="center"
                  className="!py-1.5 !px-2 whitespace-nowrap"
                >
                  Master Warranty Status
                </AdminTh>
              </AdminTr>
            </AdminThead>

            <tbody className="divide-y divide-slate-100 text-[11px] text-slate-800">
              {rows.map((row) => {
                const isOowInWarr = row.mismatchType === 'oow_in_warr';
                const daysAbs = Math.abs(row.daysDelta);

                return (
                  <AdminTr
                    key={`${row.vtrnno}-${row.serial}`}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <AdminTd className="!py-1.5 !px-2 font-mono font-medium text-slate-900">
                      <TrnLink trn={row.vtrnno} className="hover:underline">
                        {row.vtrnno}
                      </TrnLink>
                      {row.callType && (
                        <div className="text-[10px] text-slate-400 font-sans">
                          {row.callType}
                        </div>
                      )}
                    </AdminTd>

                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap">
                      <div className="font-semibold text-blue-800">{dashDate(row.callDate)}</div>
                      {row.status && (
                        <div className={`text-[10px] font-medium ${statusTextClass(row.status)}`}>
                          {row.status}
                        </div>
                      )}
                    </AdminTd>

                    <AdminTd className="!py-1.5 !px-2 font-mono font-semibold text-slate-900">
                      <span>{row.serial}</span>
                      {row.fgModel && (
                        <div className="text-[10px] text-slate-500 font-sans font-normal">
                          {row.fgModel}
                        </div>
                      )}
                    </AdminTd>

                    <AdminTd className="!py-1.5 !px-2">
                      <div className="font-medium text-slate-800 max-w-[200px] truncate" title={row.partyName || row.customerName}>
                        {row.partyName || row.customerName || '—'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {row.branchName || '—'}
                      </div>
                    </AdminTd>

                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap">
                      {row.account ? (
                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-700">
                          {row.account}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </AdminTd>

                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap">
                      {row.customerSubgroup ? (
                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-700">
                          {row.customerSubgroup}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </AdminTd>

                    <AdminTd className="!py-1.5 !px-2 font-mono whitespace-nowrap text-slate-700">
                      <div>{row.billingDoc || '—'}</div>
                      {row.billingDate && (
                        <div className="text-[10px] font-sans font-medium text-blue-800">
                          {dashDate(row.billingDate)}
                        </div>
                      )}
                    </AdminTd>

                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap">
                      <div className="font-mono font-semibold text-blue-800">
                        {dashDate(row.warrEndDt)}
                      </div>
                      <div className="text-[10px] font-medium text-blue-800/80">
                        {row.warrStartDt ? `Start: ${dashDate(row.warrStartDt)}` : ''}
                      </div>
                    </AdminTd>

                    <AdminTd align="center" className="!py-1.5 !px-2 whitespace-nowrap">
                      <span className="font-mono font-medium text-slate-700">
                        {row.warrantyMonths != null ? `${row.warrantyMonths} months` : '—'}
                      </span>
                    </AdminTd>

                    <AdminTd align="center" className="!py-1.5 !px-2 whitespace-nowrap">
                      {row.callWco === 'W' ? (
                        <span className="inline-flex items-center rounded border border-rose-400 px-1.5 py-0.2 text-[10px] font-semibold text-rose-700">
                          W (In Warr)
                        </span>
                      ) : row.callWco === 'O' ? (
                        <span className="inline-flex items-center rounded border border-amber-400 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800">
                          O (Out Warr)
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </AdminTd>

                    <AdminTd align="center" className="!py-1.5 !px-2 whitespace-nowrap">
                      {isOowInWarr ? (
                        <span className="inline-flex items-center justify-center gap-0.5 text-rose-700 font-semibold text-[10px]" title={`Expired (${daysAbs}d prior)`}>
                          <ShieldAlert className="h-3 w-3 shrink-0 text-rose-600" />
                          <span>Exp {daysAbs}d</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-0.5 text-slate-600 font-medium text-[10px]" title={`Active (${daysAbs}d left)`}>
                          <ShieldCheck className="h-3 w-3 shrink-0 text-slate-400" />
                          <span>Act {daysAbs}d</span>
                        </span>
                      )}
                    </AdminTd>
                  </AdminTr>
                );
              })}
            </tbody>
          </AdminTable>
        )}
      </AdminTableCard>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600">
        <div>
          Showing <span className="font-semibold text-slate-900">{startIdx.toLocaleString()}</span> to{' '}
          <span className="font-semibold text-slate-900">{endIdx.toLocaleString()}</span> of{' '}
          <span className="font-semibold text-slate-900">{total.toLocaleString()}</span> records
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-6 rounded border border-slate-300 bg-white px-1.5 py-0 text-[11px] font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(page - 1)}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 text-[11px] font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange(page + 1)}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
