'use client';

import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminTable, AdminTh, AdminThead } from '@/components/admin/AdminUi';
import {
  arcpTotalsHaveData,
  formatArcpAmount,
  formatArcpQty,
  type ArcpMonthlyBreakdownModel,
} from '@/features/arcp/lib/table';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

type ArcpClaimsMonthlyTableProps = {
  model: ArcpMonthlyBreakdownModel | null;
  loading?: boolean;
  updating?: boolean;
};

type MonthlySortKey = 'month' | 'qty' | 'amountPayable' | 'branchApproved' | 'hoApproved';

const cellBorder = 'border border-slate-200 px-3 py-1.5';
const numericCell = `${cellBorder} text-right tabular-nums`;

export function ArcpClaimsMonthlyTable({ model, loading, updating }: ArcpClaimsMonthlyTableProps) {
  const [sort, setSort] = useState<TableSortState<MonthlySortKey> | null>(null);

  const sortedRows = useMemo(() => {
    if (!model || !sort) return model?.rows ?? [];
    return sortRows(model.rows, (row) => {
      switch (sort.key) {
        case 'month':
          return row.monthLabel;
        case 'qty':
          return row.qty;
        case 'amountPayable':
          return row.amountPayable;
        case 'branchApproved':
          return row.branchApproved;
        case 'hoApproved':
          return row.hoApproved;
        default:
          return '';
      }
    }, sort.dir);
  }, [model, sort]);

  const handleSort = (key: MonthlySortKey) => {
    setSort((p) => toggleSort(p, key, key === 'month' ? 'asc' : 'desc'));
  };

  const hasRows = (model?.rows.length ?? 0) > 0;
  const hasTotals = model ? arcpTotalsHaveData(model.totals) : false;

  if (!hasRows && !hasTotals) {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-8" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          <p className="text-[11px] text-slate-500">Loading monthly breakdown…</p>
        </div>
      );
    }
    return (
      <p className="py-6 text-center text-[11px] text-slate-400">No monthly breakdown available.</p>
    );
  }

  if (!model) return null;

  return (
    <div>
      {updating ? (
        <p className="mb-2 text-[10px] text-slate-400" aria-live="polite">
          Monthly breakdown updates as more periods load.
        </p>
      ) : null}
      <AdminTable>
      <AdminThead>
        <tr className="bg-bg-soft">
          <AdminTh
            className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            sortable
            sortKey="month"
            sort={sort}
            onSort={(k) => handleSort(k as MonthlySortKey)}
          >
            Month
          </AdminTh>
          <AdminTh
            align="right"
            className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            sortable
            sortKey="qty"
            sort={sort}
            onSort={(k) => handleSort(k as MonthlySortKey)}
          >
            Qty
          </AdminTh>
          <AdminTh
            align="right"
            className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            sortable
            sortKey="amountPayable"
            sort={sort}
            onSort={(k) => handleSort(k as MonthlySortKey)}
          >
            Amount Payable
          </AdminTh>
          <AdminTh
            align="right"
            className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            sortable
            sortKey="branchApproved"
            sort={sort}
            onSort={(k) => handleSort(k as MonthlySortKey)}
          >
            Branch Approved
          </AdminTh>
          <AdminTh
            align="right"
            className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            sortable
            sortKey="hoApproved"
            sort={sort}
            onSort={(k) => handleSort(k as MonthlySortKey)}
          >
            HO Approved
          </AdminTh>
        </tr>
      </AdminThead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.month}>
            <td className={`${cellBorder} text-[12px] font-medium text-slate-800`}>{row.monthLabel}</td>
            <td className={`${numericCell} text-[12px] text-slate-700`}>{formatArcpQty(row.qty)}</td>
            <td className={`${numericCell} text-[12px] text-slate-700`}>
              {formatArcpAmount(row.amountPayable)}
            </td>
            <td className={`${numericCell} text-[12px] text-slate-700`}>
              {formatArcpAmount(row.branchApproved)}
            </td>
            <td className={`${numericCell} text-[12px] text-slate-700`}>
              {formatArcpAmount(row.hoApproved)}
            </td>
          </tr>
        ))}
        <tr className="bg-slate-100 font-semibold">
          <td className={`${cellBorder} py-2 text-[12px] text-slate-800`}>Total</td>
          <td className={`${numericCell} text-[12px]`}>{formatArcpQty(model.totals.qty)}</td>
          <td className={`${numericCell} text-[12px]`}>{formatArcpAmount(model.totals.amountPayable)}</td>
          <td className={`${numericCell} text-[12px]`}>{formatArcpAmount(model.totals.branchApproved)}</td>
          <td className={`${numericCell} text-[12px]`}>{formatArcpAmount(model.totals.hoApproved)}</td>
        </tr>
      </tbody>
    </AdminTable>
    </div>
  );
}
