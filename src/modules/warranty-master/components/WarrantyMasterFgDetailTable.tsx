'use client';

import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Copy, Loader2 } from 'lucide-react';
import { SortableTh } from '@/components/ui/SortableTh';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';
import type { WarrantyMasterFgDetailRow, WarrantyMasterSerialRow } from '@/modules/warranty-master/services';
import { feedback } from '@/lib/ui/feedback';

type FgDetailSortKey = 'fgModel' | 'machineCount';

type WarrantyMasterFgDetailTableProps = {
  rows: WarrantyMasterFgDetailRow[];
  parentMachineCount: number;
  customerSubgroup: string;
  groupName: string;
  customerKey?: string;
  groupKey?: string;
  warrantyMonths: number;
  loading?: boolean;
};

export function WarrantyMasterFgDetailTable({
  rows,
  parentMachineCount,
  customerSubgroup,
  groupName,
  customerKey,
  groupKey,
  warrantyMonths,
  loading = false,
}: WarrantyMasterFgDetailTableProps) {
  const [sort, setSort] = useState<TableSortState<FgDetailSortKey>>({
    key: 'fgModel',
    dir: 'asc',
  });

  const [expandedFgModel, setExpandedFgModel] = useState<string | null>(null);
  const [serialsCache, setSerialsCache] = useState<Record<string, WarrantyMasterSerialRow[]>>({});
  const [loadingSerialsFor, setLoadingSerialsFor] = useState<string | null>(null);
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    return sortRows(
      rows,
      (row) => (sort.key === 'fgModel' ? row.fgModel : row.machineCount),
      sort.dir
    );
  }, [rows, sort]);

  const subtotal = useMemo(
    () => sortedRows.reduce((sum, r) => sum + r.machineCount, 0),
    [sortedRows]
  );

  const handleSort = (key: FgDetailSortKey) => {
    setSort((p) => toggleSort(p, key, key === 'fgModel' ? 'asc' : 'desc'));
  };

  const handleToggleFgSerials = async (fgModel: string) => {
    if (expandedFgModel === fgModel) {
      setExpandedFgModel(null);
      return;
    }

    setExpandedFgModel(fgModel);
    if (serialsCache[fgModel]) {
      return;
    }

    setLoadingSerialsFor(fgModel);
    try {
      const q = new URLSearchParams({
        mode: 'serials',
        fgModel,
        rowWarrantyMonths: String(warrantyMonths),
      });
      if (customerKey) q.set('customerKey', customerKey);
      if (groupKey) q.set('groupKey', groupKey);

      const res = await fetch(`/api/report/warranty-master?${q.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load serials');
      const data = (await res.json()) as { serials: WarrantyMasterSerialRow[] };
      setSerialsCache((prev) => ({ ...prev, [fgModel]: data.serials ?? [] }));
    } catch {
      feedback.actionFailed('Failed to load serial numbers');
    } finally {
      setLoadingSerialsFor(null);
    }
  };

  const handleCopySerial = async (serial: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(serial);
      setCopiedSerial(serial);
      feedback.actionSuccess(`Copied ${serial}`);
      setTimeout(() => setCopiedSerial((prev) => (prev === serial ? null : prev)), 2000);
    } catch {
      feedback.actionFailed('Failed to copy');
    }
  };

  const handleCopyAllSerials = async (serials: WarrantyMasterSerialRow[], e: React.MouseEvent) => {
    e.stopPropagation();
    if (serials.length === 0) return;
    try {
      const text = serials.map((s) => s.serialNo).join('\n');
      await navigator.clipboard.writeText(text);
      feedback.actionSuccess(`Copied ${serials.length} serials to clipboard`);
    } catch {
      feedback.actionFailed('Failed to copy serials');
    }
  };

  if (loading && sortedRows.length === 0) {
    return (
      <div className="warranty-master-detail-wrap">
        <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-slate-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
          Loading FG models…
        </div>
      </div>
    );
  }

  if (sortedRows.length === 0) {
    return (
      <p className="py-4 text-center text-[11px] text-slate-500">No FG models for this row.</p>
    );
  }

  return (
    <div className="warranty-master-detail-wrap">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            FG model breakdown
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            {customerSubgroup} · {groupName} · {warrantyMonths} mo
          </p>
        </div>
        <p className="text-[10px] text-slate-500">
          {sortedRows.length} model{sortedRows.length === 1 ? '' : 's'} · Click a model to view serials
        </p>
      </div>

      <table className="warranty-master-detail-table w-full">
        <colgroup>
          <col className="w-8" />
          <col />
          <col className="w-28 text-right" />
          <col className="w-32 text-right" />
        </colgroup>
        <thead>
          <tr>
            <th className="w-8"></th>
            <SortableTh
              active={sort.key === 'fgModel'}
              dir={sort.dir}
              onClick={() => handleSort('fgModel')}
            >
              FG model
            </SortableTh>
            <SortableTh
              align="right"
              active={sort.key === 'machineCount'}
              dir={sort.dir}
              onClick={() => handleSort('machineCount')}
            >
              Count of M/c
            </SortableTh>
            <th className="text-right pr-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              Serials
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((d, idx) => {
            const isExpanded = expandedFgModel === d.fgModel;
            const isLoadingThis = loadingSerialsFor === d.fgModel;
            const fgSerials = serialsCache[d.fgModel] ?? [];

            return (
              <React.Fragment key={`${d.fgModel}-${idx}`}>
                <tr
                  onClick={() => void handleToggleFgSerials(d.fgModel)}
                  className={`cursor-pointer transition-colors ${
                    isExpanded ? 'bg-slate-100/80 font-medium' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="text-center text-slate-400 pl-2">
                    {isLoadingThis ? (
                      <Loader2 className="h-3 w-3 animate-spin inline text-slate-500" />
                    ) : (
                      <ChevronRight
                        className={`h-3.5 w-3.5 inline transition-transform ${
                          isExpanded ? 'rotate-90 text-slate-700' : ''
                        }`}
                      />
                    )}
                  </td>
                  <td className="max-w-0 font-medium text-slate-800">
                    <TruncatedText text={d.fgModel} />
                  </td>
                  <td className="text-right tabular-nums text-slate-700 font-semibold">
                    {d.machineCount.toLocaleString()}
                  </td>
                  <td className="text-right pr-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggleFgSerials(d.fgModel);
                      }}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-800 underline"
                    >
                      {isExpanded ? 'Hide serials' : 'View serials'}
                    </button>
                  </td>
                </tr>

                {/* Sub-table for machine serial numbers */}
                {isExpanded ? (
                  <tr className="bg-slate-50/90 border-b border-slate-200">
                    <td colSpan={4} className="p-2 sm:p-3 pl-8">
                      <div className="rounded border border-slate-200 bg-white p-2 shadow-2xs">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Machine Serials ({fgSerials.length})
                          </span>
                          {fgSerials.length > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => void handleCopyAllSerials(fgSerials, e)}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-200"
                            >
                              <Copy className="h-2.5 w-2.5" />
                              Copy all
                            </button>
                          ) : null}
                        </div>

                        {isLoadingThis ? (
                          <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-slate-500">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading serials…
                          </div>
                        ) : fgSerials.length === 0 ? (
                          <p className="py-2 text-center text-[11px] text-slate-400">
                            No serial records found for this model.
                          </p>
                        ) : (
                          <div className="max-h-56 overflow-y-auto custom-scrollbar">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-400">
                                <tr>
                                  <th className="py-1 px-2">Serial No</th>
                                  <th className="py-1 px-2">Start Date</th>
                                  <th className="py-1 px-2">End Date</th>
                                  <th className="py-1 px-2">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {fgSerials.map((s, sIdx) => {
                                  const isCopied = copiedSerial === s.serialNo;
                                  return (
                                    <tr key={`${s.serialNo}-${sIdx}`} className="hover:bg-slate-50/80">
                                      <td className="py-1 px-2 font-mono font-medium text-slate-800">
                                        <div className="flex items-center gap-1">
                                          <span>{s.serialNo}</span>
                                          <button
                                            type="button"
                                            onClick={(e) => void handleCopySerial(s.serialNo, e)}
                                            className="p-0.5 text-slate-400 hover:text-slate-600"
                                            title="Copy serial"
                                          >
                                            {isCopied ? (
                                              <Check className="h-2.5 w-2.5 text-emerald-600" />
                                            ) : (
                                              <Copy className="h-2.5 w-2.5" />
                                            )}
                                          </button>
                                        </div>
                                      </td>
                                      <td className="py-1 px-2 text-slate-600 tabular-nums">
                                        {s.warrStartDt ?? '—'}
                                      </td>
                                      <td className="py-1 px-2 text-slate-600 tabular-nums">
                                        {s.warrEndDt ?? '—'}
                                      </td>
                                      <td className="py-1 px-2">
                                        <span
                                          className={`inline-flex items-center px-1 rounded text-[9px] font-semibold ${
                                            s.isActive
                                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                                          }`}
                                        >
                                          {s.isActive ? 'Active' : 'Expired'}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="warranty-master-detail-table-foot border-t border-slate-200 font-semibold">
            <td></td>
            <td className="font-semibold text-slate-700">Subtotal</td>
            <td className="text-right tabular-nums font-semibold text-slate-800">
              {subtotal.toLocaleString()}
              {subtotal !== parentMachineCount ? (
                <span
                  className="ml-1.5 text-[10px] font-normal text-amber-700"
                  title="Subtotal differs from parent row count"
                >
                  (parent: {parentMachineCount.toLocaleString()})
                </span>
              ) : null}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
