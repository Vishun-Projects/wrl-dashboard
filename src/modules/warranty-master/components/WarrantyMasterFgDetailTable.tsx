'use client';

import React, { useMemo, useState } from 'react';
import { SortableTh } from '@/components/ui/SortableTh';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';
import type { WarrantyMasterFgDetailRow } from '@/modules/warranty-master/services';

type FgDetailSortKey = 'fgModel' | 'machineCount';

type WarrantyMasterFgDetailTableProps = {
  rows: WarrantyMasterFgDetailRow[];
  parentMachineCount: number;
  customerName: string;
  groupName: string;
  warrantyMonths: number;
  loading?: boolean;
};

export function WarrantyMasterFgDetailTable({
  rows,
  parentMachineCount,
  customerName,
  groupName,
  warrantyMonths,
  loading = false,
}: WarrantyMasterFgDetailTableProps) {
  const [sort, setSort] = useState<TableSortState<FgDetailSortKey>>({
    key: 'fgModel',
    dir: 'asc',
  });

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
            {customerName} · {groupName} · {warrantyMonths} mo
          </p>
        </div>
        <p className="text-[10px] text-slate-500">
          {sortedRows.length} model{sortedRows.length === 1 ? '' : 's'}
        </p>
      </div>

      <table className="warranty-master-detail-table">
        <colgroup>
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
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
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((d, idx) => (
            <tr key={`${d.fgModel}-${idx}`}>
              <td className="max-w-0 font-medium text-slate-800">
                <TruncatedText text={d.fgModel} />
              </td>
              <td className="text-right tabular-nums text-slate-700">
                {d.machineCount.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="warranty-master-detail-table-foot">
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
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
