'use client';

import React from 'react';
import { AdminTable, AdminTh, AdminThead } from '@/components/admin/AdminUi';
import {
  formatArcpAmount,
  formatArcpQty,
  type ArcpMonthlyBreakdownModel,
} from '@/lib/arcp-claims-table';

type ArcpClaimsMonthlyTableProps = {
  model: ArcpMonthlyBreakdownModel | null;
  loading?: boolean;
};

const cellBorder = 'border border-slate-200 px-3 py-1.5';
const numericCell = `${cellBorder} text-right tabular-nums`;

export function ArcpClaimsMonthlyTable({ model, loading }: ArcpClaimsMonthlyTableProps) {
  if (!model || model.rows.length === 0) {
    if (loading) return null;
    return (
      <p className="py-6 text-center text-[11px] text-slate-400">No monthly breakdown available.</p>
    );
  }

  return (
    <AdminTable>
      <AdminThead>
        <tr className="bg-slate-50">
          <AdminTh className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>Month</AdminTh>
          <AdminTh align="right" className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
            Qty
          </AdminTh>
          <AdminTh align="right" className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
            Amount Payable
          </AdminTh>
          <AdminTh align="right" className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
            Branch Approved
          </AdminTh>
          <AdminTh align="right" className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
            HO Approved
          </AdminTh>
        </tr>
      </AdminThead>
      <tbody>
        {model.rows.map((row) => (
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
  );
}
