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
          <TableSkeleton columns={10} rows={10} />
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
                  Account
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="callDate"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2 bg-blue-50/40 text-blue-900 border-l border-slate-200"
                >
                  Call Date
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="warrEndDt"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2 bg-blue-50/40 text-blue-900"
                >
                  Master Warranty End
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="warrantyMonths"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  align="center"
                  className="!py-1.5 !px-2 bg-blue-50/40 text-blue-900 border-r border-slate-200"
                >
                  Warranty Months
                </AdminTh>
                <AdminTh align="center" className="!py-1.5 !px-2 bg-amber-50/40 text-amber-900">
                  Call WCO
                </AdminTh>
                <AdminTh
                  sortable
                  sortKey="daysDelta"
                  sort={{ key: sortBy, dir: sortDir }}
                  onSort={onSortChange}
                  className="!py-1.5 !px-2 bg-amber-50/40 text-amber-900 border-r border-slate-200"
                >
                  Master Warranty Status
                </AdminTh>
                <AdminTh className="!py-1.5 !px-2">
                  Mismatch Classification
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
                    {/* 1. Call No */}
                    <AdminTd className="!py-1.5 !px-2 font-mono font-medium text-blue-600">
                      <TrnLink trn={row.vtrnno} className="hover:underline">
                        {row.vtrnno}
                      </TrnLink>
                      {row.callType && (
                        <div className="text-[10px] text-slate-400 font-sans">
                          {row.callType}
                        </div>
                      )}
                    </AdminTd>

                    {/* 2. Serial No */}
                    <AdminTd className="!py-1.5 !px-2 font-mono font-semibold text-slate-900">
                      <span>{row.serial}</span>
                      {row.fgModel && (
                        <div className="text-[10px] text-slate-500 font-sans font-normal">
                          {row.fgModel}
                        </div>
                      )}
                    </AdminTd>

                    {/* 3. Customer & Branch */}
                    <AdminTd className="!py-1.5 !px-2">
                      <div className="font-medium text-slate-800 max-w-[200px] truncate" title={row.partyName || row.customerName}>
                        {row.partyName || row.customerName || '—'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {row.branchName || '—'}
                      </div>
                    </AdminTd>

                    {/* 4. Account */}
                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap">
                      {row.account ? (
                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-700">
                          {row.account}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </AdminTd>

                    {/* 5. Call Date (Dates side-by-side 1/3) */}
                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap text-slate-800 font-medium bg-blue-50/20 border-l border-slate-100">
                      <div>{row.callDate}</div>
                      {row.status && (
                        <div className="text-[10px] text-slate-500 font-normal">
                          {row.status}
                        </div>
                      )}
                    </AdminTd>

                    {/* 6. Master Warranty End (Dates side-by-side 2/3) */}
                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap bg-blue-50/20">
                      <div className="font-mono text-slate-800 font-medium">
                        {row.warrEndDt || '—'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {row.warrStartDt ? `Start: ${row.warrStartDt}` : ''}
                      </div>
                    </AdminTd>

                    {/* 7. Warranty Months (Dates side-by-side 3/3) */}
                    <AdminTd className="!py-1.5 !px-2 text-center whitespace-nowrap bg-blue-50/20 border-r border-slate-100">
                      <span className="font-mono font-medium text-slate-700">
                        {row.warrantyMonths != null ? `${row.warrantyMonths} months` : '—'}
                      </span>
                    </AdminTd>

                    {/* 8. Call Register WCO (Status side-by-side 1/2) */}
                    <AdminTd className="!py-1.5 !px-2 text-center whitespace-nowrap bg-amber-50/20">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold ${row.callWco === 'W'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : row.callWco === 'O'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-slate-100 text-slate-700'
                          }`}
                      >
                        {row.callWco === 'W' ? 'W (In Warr)' : row.callWco === 'O' ? 'O (Out Warr)' : row.callWco || '—'}
                      </span>
                    </AdminTd>

                    {/* 9. Master Status on Call Date (Status side-by-side 2/2) */}
                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap bg-amber-50/20 border-r border-slate-100">
                      {isOowInWarr ? (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-semibold text-[10px]">
                          <ShieldAlert className="h-3 w-3 text-rose-600" />
                          <span>Expired ({daysAbs}d prior)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[10px]">
                          <ShieldCheck className="h-3 w-3 text-emerald-600" />
                          <span>Active ({daysAbs}d left)</span>
                        </span>
                      )}
                    </AdminTd>

                    {/* 10. Mismatch Classification */}
                    <AdminTd className="!py-1.5 !px-2 whitespace-nowrap">
                      {isOowInWarr ? (
                        <span className="inline-flex items-center rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 border border-rose-200">
                          Machine OOW → Call In-Warr
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 border border-amber-200">
                          Machine In-Warr → Call OOW
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

      {/* Pagination Footer */}
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
