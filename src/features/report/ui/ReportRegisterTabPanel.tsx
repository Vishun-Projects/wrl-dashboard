'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HorizontalScrollFade } from '@/components/ui/HorizontalScrollFade';
import { SortableTh } from '@/components/ui/SortableTh';
import { ReportErrorBoundary } from '@/features/report/ui/ReportErrorBoundary';
import { ReportLoadingPanel } from '@/features/report/ui/ReportLoadingFeedback';
import { RegisterColumnPicker } from '@/features/register/ui/RegisterColumnPicker';
import {
  REGISTER_PAGE_SIZE_OPTIONS,
  type RegisterPageSize,
} from '@/features/report/lib/filters';
import type { RegisterTableColumnKey } from '@/features/register';
import { toggleSort, type TableSortState } from '@/lib/ui/table-sort';

type ColumnDef = { key: RegisterTableColumnKey; label: string };

type Props = {
  loading: boolean;
  data: unknown[];
  displayedData: Record<string, unknown>[];
  total: number;
  page: number;
  limit: RegisterPageSize;
  visibleRegisterColumns: RegisterTableColumnKey[];
  setVisibleRegisterColumns: (cols: RegisterTableColumnKey[]) => void;
  visibleRegisterColumnDefs: ColumnDef[];
  getRegisterCellClassName: (key: RegisterTableColumnKey) => string;
  renderRegisterCell: (key: RegisterTableColumnKey, row: Record<string, unknown>) => React.ReactNode;
  isAnyRegisterFilterActive: boolean;
  clearAllFilters: () => void;
  runRegisterFilterLoad: (opts: { force: boolean }) => void | Promise<void>;
  handleRegisterPageSizeChange: (size: number) => void;
  setPage: (page: number) => void;
  fetchData: (page: number) => void;
  sort: TableSortState<RegisterTableColumnKey> | null;
  onSortChange: (sort: TableSortState<RegisterTableColumnKey>) => void;
};

export function ReportRegisterTabPanel({
  loading,
  data,
  displayedData,
  total,
  page,
  limit,
  visibleRegisterColumns,
  setVisibleRegisterColumns,
  visibleRegisterColumnDefs,
  getRegisterCellClassName,
  renderRegisterCell,
  isAnyRegisterFilterActive,
  clearAllFilters,
  runRegisterFilterLoad,
  handleRegisterPageSizeChange,
  setPage,
  fetchData,
  sort,
  onSortChange,
}: Props) {
  return (
    <ReportErrorBoundary label="Call Register">
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
        {loading && data.length === 0 ? (
          <ReportLoadingPanel label="Loading call register…" className="flex-1" />
        ) : (
          <>
            <div className="register-table-meta">
              <span className="text-[11px] font-medium text-slate-700">
                {total.toLocaleString()} {total === 1 ? 'call' : 'calls'}
              </span>
              <RegisterColumnPicker
                visibleColumns={visibleRegisterColumns}
                onChange={setVisibleRegisterColumns}
              />
            </div>
            <HorizontalScrollFade
              className="min-h-0 min-w-0 flex-1"
              scrollClassName="register-table-wrap inner-scrollbar"
            >
              <table className="register-table">
                <colgroup>
                  <col className="register-col-num" />
                  <col className="register-col-id" />
                </colgroup>
                <thead className="sticky top-0 z-20 border-b border-slate-200 bg-bg-soft">
                  <tr>
                    <th className="register-table-sticky-col register-table-sticky-col-1 border-r border-slate-100 px-2 py-2.5 text-center text-[11px] font-medium whitespace-nowrap text-slate-500">
                      #
                    </th>
                    {visibleRegisterColumnDefs.map((col, colIdx) => (
                      <SortableTh
                        key={col.key}
                        className={`border-r border-slate-100 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap text-slate-500 ${colIdx === 0 ? 'register-table-sticky-col register-table-sticky-col-2' : ''}`}
                        active={sort?.key === col.key}
                        dir={sort?.dir}
                        onClick={() => onSortChange(toggleSort(sort, col.key, 'asc'))}
                      >
                        {col.label}
                      </SortableTh>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-bg-canvas">
                  {displayedData.length > 0 ? (
                    displayedData.map((row, idx) => (
                      <tr key={idx} className="transition-colors hover:bg-bg-soft">
                        <td className="register-table-sticky-col register-table-sticky-col-1 whitespace-nowrap border-r border-slate-50 px-2 py-2 text-center text-[11px] text-slate-400">
                          {(page - 1) * limit + idx + 1}
                        </td>
                        {visibleRegisterColumnDefs.map((col, colIdx) => (
                          <td
                            key={col.key}
                            className={`${getRegisterCellClassName(col.key)} ${colIdx === 0 ? 'register-table-sticky-col register-table-sticky-col-2' : ''}`}
                          >
                            {renderRegisterCell(col.key, row)}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={visibleRegisterColumnDefs.length + 1}
                        className="register-table-empty"
                      >
                        <p className="text-sm font-medium text-slate-700">
                          No calls match your filters
                        </p>
                        {isAnyRegisterFilterActive && (
                          <button
                            type="button"
                            onClick={() => {
                              clearAllFilters();
                              void runRegisterFilterLoad({ force: true });
                            }}
                            className="mt-3 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-bg-soft"
                          >
                            Clear filters
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </HorizontalScrollFade>
            <div className="flex h-11 flex-shrink-0 items-center justify-between border-t border-slate-200 bg-bg-soft px-4">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                <span className="font-medium text-slate-700">
                  {total > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, total)} of{' '}
                  {total.toLocaleString()}
                </span>
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">Rows</span>
                  <select
                    value={limit}
                    onChange={(e) => handleRegisterPageSizeChange(Number(e.target.value))}
                    disabled={loading && data.length === 0}
                    className="rounded border border-slate-200 bg-bg-canvas px-2 py-0.5 text-[11px] font-medium text-slate-700 shadow-sm hover:border-slate-300 focus:border-slate-400 focus:outline-none disabled:opacity-50"
                    aria-label="Rows per page"
                  >
                    {REGISTER_PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const newPage = Math.max(1, page - 1);
                    setPage(newPage);
                    fetchData(newPage);
                  }}
                  disabled={page <= 1 || loading}
                  className="p-1.5 rounded bg-bg-canvas border border-slate-200 text-slate-600 hover:bg-bg-soft disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>

                <div className="flex items-center gap-1 mx-2">
                  {(() => {
                    const totalPages = Math.max(1, Math.ceil(total / limit));
                    const pages: Array<number | '...'> = [];
                    const windowSize = 2;

                    pages.push(1);
                    if (page > windowSize + 2) pages.push('...');

                    const start = Math.max(2, page - windowSize);
                    const end = Math.min(totalPages - 1, page + windowSize);
                    for (let p = start; p <= end; p++) pages.push(p);

                    if (page < totalPages - (windowSize + 1)) pages.push('...');
                    if (totalPages > 1) pages.push(totalPages);

                    return pages.map((p, idx) => {
                      if (p === '...')
                        return (
                          <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 text-[12px]">
                            ...
                          </span>
                        );
                      return (
                        <button
                          key={p}
                          onClick={() => {
                            setPage(p as number);
                            fetchData(p as number);
                          }}
                          className={`w-8 h-8 flex items-center justify-center rounded text-[12px] transition-all font-medium ${page === p ? 'bg-slate-900 text-white shadow-sm' : 'bg-bg-canvas border border-slate-200 text-slate-600 hover:bg-bg-soft'}`}
                        >
                          {p}
                        </button>
                      );
                    });
                  })()}
                </div>

                {loading && (
                  <span className="inline-block w-3 h-3 border-2 border-slate-600 border-t-transparent rounded-full animate-spin ml-2" />
                )}

                <button
                  onClick={() => {
                    const totalPages = Math.max(1, Math.ceil(total / limit));
                    const newPage = Math.min(totalPages, page + 1);
                    setPage(newPage);
                    fetchData(newPage);
                  }}
                  disabled={page >= Math.ceil(total / limit) || loading}
                  className="p-1.5 rounded bg-bg-canvas border border-slate-200 text-slate-600 hover:bg-bg-soft disabled:opacity-50 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ReportErrorBoundary>
  );
}
