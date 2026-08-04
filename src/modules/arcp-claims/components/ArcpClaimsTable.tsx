'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { AdminTable, AdminTh, AdminThead } from '@/components/admin/AdminUi';
import {
  arcpModelHasDisplayableContent,
  formatArcpAmount,
  formatArcpQty,
  formatArcpRate,
  type ArcpClaimsTableModel,
  type ArcpTableRow,
} from '@/modules/arcp-claims/services/table';

type ArcpClaimsTableProps = {
  model: ArcpClaimsTableModel | null;
  loading?: boolean;
  updating?: boolean;
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

export function ArcpClaimsTable({ model, loading, updating }: ArcpClaimsTableProps) {
  const hasContent = arcpModelHasDisplayableContent(model);
  const showInitialSpinner = Boolean(loading) && !hasContent;

  if (showInitialSpinner) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        <p className="text-[11px] text-slate-500">Loading ARCP tally…</p>
      </div>
    );
  }

  if (!model) {
    return null;
  }

  if (model.rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-bg-canvas px-4 py-8 text-center">
        <p className="text-sm font-medium text-slate-700">Grand total </p>
        <div className="mt-4 grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">Qty</p>
            <p className="text-lg font-semibold tabular-nums">{formatArcpQty(model.totals.qty)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">Amount payable</p>
            <p className="text-lg font-semibold tabular-nums">{formatArcpAmount(model.totals.amountPayable)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">Branch approved</p>
            <p className="text-lg font-semibold tabular-nums">{formatArcpAmount(model.totals.branchApproved)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">HO approved</p>
            <p className="text-lg font-semibold tabular-nums">{formatArcpAmount(model.totals.hoApproved)}</p>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-slate-500">
          Switch <strong>Tally detail</strong> to Full breakdown or By category to see line items.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {updating ? (
        <p className="mb-2 text-[10px] text-slate-400" aria-live="polite">
          More periods still loading — totals update as each completes.
        </p>
      ) : null}
      <AdminTable>
      <AdminThead>
        <tr className="bg-bg-soft">
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
              <tr key={`header-${index}`} className="bg-bg-soft/80">
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

          const isCategoryRollup = row.isCategoryTotal === true;

          return (
            <tr key={`data-${index}`} className={isCategoryRollup ? 'bg-bg-soft/40' : undefined}>
              <td
                className={`${cellBorder} text-[12px] text-slate-700 ${
                  isCategoryRollup ? 'font-medium' : 'pl-8'
                }`}
              >
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
