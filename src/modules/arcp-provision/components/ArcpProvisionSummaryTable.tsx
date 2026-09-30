'use client';

import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { AdminTable, AdminTh, AdminThead } from '@/components/admin/AdminUi';
import {
  formatArcpAmount,
  formatArcpQty,
  formatArcpRate,
  type ArcpProvisionSummaryTableModel,
} from '@/modules/arcp-provision/services/table';

const cellBorder = 'border border-slate-200 px-3 py-1.5';
const numericCell = `${cellBorder} text-right tabular-nums`;

type Props = {
  model: ArcpProvisionSummaryTableModel | null;
  loading?: boolean;
};

/** Summary: Branch toggle only — open branch shows Claims-style category + Local/Upcountry rows. */
export function ArcpProvisionSummaryTable({ model, loading }: Props) {
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!model) return;
    // One branch in filter → open it. Otherwise start collapsed.
    if (model.branches.length === 1) {
      setExpandedBranches(new Set([model.branches[0]!.branchId]));
    } else {
      setExpandedBranches(new Set());
    }
  }, [model]);

  if (loading && (!model || model.branches.length === 0)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <p className="text-sm font-medium text-slate-600">Loading ARCP provision…</p>
      </div>
    );
  }

  if (!model || model.branches.length === 0) {
    return null;
  }

  const allOpen = expandedBranches.size === model.branches.length;
  const toggleBranch = (branchId: string) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };
  const expandAll = () => setExpandedBranches(new Set(model.branches.map((b) => b.branchId)));
  const collapseAll = () => setExpandedBranches(new Set());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-slate-100 px-2 py-1">
        <button
          type="button"
          onClick={allOpen ? collapseAll : expandAll}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <AdminTable className="w-full min-w-[880px] border-collapse text-left">
        <AdminThead>
          <tr className="bg-bg-soft">
            <AdminTh className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
              Service Description
            </AdminTh>
            <AdminTh
              align="right"
              className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            >
              Rate as per Mst.
            </AdminTh>
            <AdminTh
              align="right"
              className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            >
              Qty
            </AdminTh>
            <AdminTh
              align="right"
              className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            >
              Rate × qty
            </AdminTh>
            <AdminTh
              align="right"
              className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            >
              Rate as per CRM
            </AdminTh>
            <AdminTh
              align="right"
              className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            >
              Variance
            </AdminTh>
          </tr>
        </AdminThead>
        <tbody>
          {model.branches.map((branch) => {
            const branchOpen = expandedBranches.has(branch.branchId);
            const BranchChevron = branchOpen ? ChevronDown : ChevronRight;
            return (
              <Fragment key={branch.branchId}>
                <tr
                  className="cursor-pointer bg-slate-100/90 hover:bg-slate-100"
                  onClick={() => toggleBranch(branch.branchId)}
                  title={branchOpen ? 'Collapse branch' : 'Expand branch'}
                >
                  <td className={`${cellBorder} text-[12px] font-semibold text-slate-900`}>
                    <span className="inline-flex items-center gap-1.5">
                      <BranchChevron className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                      {branch.branchName}
                      <span className="text-[10px] font-normal text-slate-500">
                        ({branch.sections.length} categor
                        {branch.sections.length === 1 ? 'y' : 'ies'})
                      </span>
                    </span>
                  </td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>—</td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpQty(branch.qty)}
                  </td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpAmount(branch.rateMst)}
                  </td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpAmount(branch.rateCrm)}
                  </td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpAmount(branch.variance)}
                  </td>
                </tr>

                {branchOpen
                  ? branch.sections.map((section) => (
                      <Fragment key={`${branch.branchId}\0${section.key}`}>
                        <tr className="bg-bg-soft/80">
                          <td
                            colSpan={6}
                            className={`${cellBorder} pl-7 py-1.5 text-[12px] font-semibold text-slate-800`}
                          >
                            {section.title}
                            <span className="ml-2 text-[10px] font-normal text-slate-500">
                              qty {formatArcpQty(section.qty)} · mst{' '}
                              {formatArcpAmount(section.rateMst)} · crm{' '}
                              {formatArcpAmount(section.rateCrm)} · var{' '}
                              {formatArcpAmount(section.variance)}
                            </span>
                          </td>
                        </tr>
                        {section.rows.map((row, i) => {
                          const mismatch =
                            row.variance != null && Math.abs(row.variance) > 0.01;
                          return (
                            <tr
                              key={`${branch.branchId}-${section.key}-${i}`}
                              className={mismatch ? 'bg-amber-50/80' : undefined}
                            >
                              <td className={`${cellBorder} pl-10 text-[12px] text-slate-700`}>
                                {row.serviceDescriptionSubLabel}
                              </td>
                              <td className={`${numericCell} text-[12px]`}>
                                {formatArcpRate(row.rateCardUnit)}
                              </td>
                              <td className={`${numericCell} text-[12px]`}>
                                {formatArcpQty(row.qty)}
                              </td>
                              <td className={`${numericCell} text-[12px]`}>
                                {formatArcpAmount(row.rateMst)}
                              </td>
                              <td className={`${numericCell} text-[12px]`}>
                                {formatArcpAmount(row.rateCrm)}
                              </td>
                              <td
                                className={`${numericCell} text-[12px] ${mismatch ? 'font-semibold text-amber-800' : ''}`}
                              >
                                {formatArcpAmount(row.variance)}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))
                  : null}

                {branchOpen && branch.travelAmount > 0 ? (
                  <tr className="bg-sky-50/70">
                    <td className={`${cellBorder} pl-7 text-[12px] font-medium text-sky-900`}>
                      Travel reimbursement
                    </td>
                    <td className={numericCell} />
                    <td className={numericCell} />
                    <td className={numericCell} />
                    <td className={`${numericCell} text-[12px]`}>
                      {formatArcpAmount(branch.travelAmount)}
                    </td>
                    <td className={numericCell} />
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          <tr className="bg-bg-soft font-semibold">
            <td className={`${cellBorder} text-[12px]`}>Grand total</td>
            <td className={numericCell} />
            <td className={`${numericCell} text-[12px]`}>{formatArcpQty(model.totals.qty)}</td>
            <td className={`${numericCell} text-[12px]`}>
              {formatArcpAmount(model.totals.rateMst)}
            </td>
            <td className={`${numericCell} text-[12px]`}>
              {formatArcpAmount(model.totals.rateCrm)}
            </td>
            <td className={`${numericCell} text-[12px]`}>
              {formatArcpAmount(model.totals.variance)}
            </td>
          </tr>
        </tbody>
      </AdminTable>
    </div>
  );
}
