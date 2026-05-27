'use client';

import React from 'react';
import { AdminTable, AdminTh, AdminThead } from '@/components/admin/AdminUi';
import {
  formatArcpAmount,
  formatArcpQty,
  formatArcpRate,
  type ArcpClaimsTableModel,
  type ArcpTableRow,
} from '@/lib/arcp-claims-table';

type ArcpClaimsTableProps = {
  model: ArcpClaimsTableModel | null;
  loading?: boolean;
  loadProgress?: { done: number; total: number } | null;
};

const cellBorder = 'border border-slate-200 px-3 py-1.5';
const numericCell = `${cellBorder} text-right tabular-nums`;

function renderTravelCells(row: Extract<ArcpTableRow, { kind: 'travel' }>) {
  return (
    <>
      <td className={numericCell}>{formatArcpRate(row.rate)}</td>
      <td className={numericCell} />
      <td className={numericCell}>{formatArcpAmount(row.amountPayable)}</td>
      <td className={numericCell}>{formatArcpAmount(row.branchApproved)}</td>
      <td className={numericCell}>{formatArcpAmount(row.hoApproved)}</td>
    </>
  );
}

function renderDataCells(row: Extract<ArcpTableRow, { kind: 'data' }>) {
  return (
    <>
      <td className={numericCell}>{formatArcpRate(row.rate)}</td>
      <td className={numericCell}>{formatArcpQty(row.qty)}</td>
      <td className={numericCell}>{formatArcpAmount(row.amountPayable)}</td>
      <td className={numericCell}>{formatArcpAmount(row.branchApproved)}</td>
      <td className={numericCell}>{formatArcpAmount(row.hoApproved)}</td>
    </>
  );
}

export function ArcpClaimsTable({ model, loading, loadProgress }: ArcpClaimsTableProps) {
  const showInitialSpinner = loading && (!model || model.rows.length === 0);

  if (showInitialSpinner) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
        {loadProgress && loadProgress.total > 1 ? (
          <p className="text-[11px] text-slate-500">
            Loading period {loadProgress.done} of {loadProgress.total}…
          </p>
        ) : null}
      </div>
    );
  }

  if (!model || model.rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
        <p className="text-sm font-medium text-slate-600">No ARCP claim data for this filter set</p>
        <p className="text-[11px] text-slate-400">Try widening the date range or clearing branch filters.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading && loadProgress && loadProgress.total > 1 ? (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
          <span>
            Loading tally… period {Math.min(loadProgress.done + 1, loadProgress.total)} of{' '}
            {loadProgress.total}
          </span>
          <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-800 transition-all duration-300"
              style={{
                width: `${Math.round((loadProgress.done / loadProgress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      <AdminTable>
      <AdminThead>
        <tr className="bg-slate-50">
          <AdminTh className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
            Service Description
          </AdminTh>
          <AdminTh align="right" className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
            Rate
          </AdminTh>
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
        {model.rows.map((row, index) => {
          if (row.kind === 'section-header') {
            return (
              <tr key={`header-${index}`} className="bg-slate-50/80">
                <td
                  colSpan={6}
                  className={`${cellBorder} py-2 text-[12px] font-semibold text-slate-800`}
                >
                  {row.serviceDescription}
                </td>
              </tr>
            );
          }

          if (row.kind === 'travel') {
            return (
              <tr key={`travel-${index}`}>
                <td className={`${cellBorder} text-[12px] font-medium text-slate-800`}>
                  {row.serviceDescription}
                </td>
                {renderTravelCells(row)}
              </tr>
            );
          }

          return (
            <tr key={`data-${index}`}>
              <td className={`${cellBorder} pl-8 text-[12px] text-slate-700`}>
                {row.serviceDescriptionSubLabel}
              </td>
              {renderDataCells(row)}
            </tr>
          );
        })}
        <tr className="bg-slate-100 font-semibold">
          <td colSpan={2} className={`${cellBorder} py-2 text-[12px] text-slate-800`}>
            Total
          </td>
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
