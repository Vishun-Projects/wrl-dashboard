'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { AdminTable, AdminTh, AdminThead } from '@/components/admin/AdminUi';
import { formatExportDate } from '@/lib/utils/export-dates';
import {
  formatArcpAmount,
  formatArcpRate,
  type ArcpProvisionTableModel,
  type ArcpProvisionTallyVendor,
} from '@/modules/arcp-provision/services/table';
import type { ArcpProvisionDetailRow } from '@/modules/arcp-provision/types';

const cellBorder = 'border border-slate-200 px-3 py-1.5';
const numericCell = `${cellBorder} text-right tabular-nums`;
const API = '/api/report/arcp-provision';
const COL_COUNT = 7;

type VendorCache = {
  loading: boolean;
  rows: ArcpProvisionDetailRow[];
  error: string | null;
};

type Props = {
  model: ArcpProvisionTableModel | null;
  loading?: boolean;
  startDate: string;
  endDate: string;
  dateFilterColumn: string;
  callType: string;
};

function vendorKey(row: ArcpProvisionTallyVendor): string {
  return `${row.branchId}:${row.franchiseeId}`;
}

export function ArcpProvisionTallyTable({
  model,
  loading,
  startDate,
  endDate,
  dateFilterColumn,
  callType,
}: Props) {
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(() => new Set());
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(() => new Set());
  const [vendorCache, setVendorCache] = useState<Record<string, VendorCache>>({});

  useEffect(() => {
    if (!model) return;
    if (model.branches.length === 1) {
      setExpandedBranches(new Set([model.branches[0]!.branchId]));
    } else {
      setExpandedBranches(new Set());
    }
    setExpandedVendors(new Set());
  }, [model]);

  const loadVendorLines = useCallback(
    async (row: ArcpProvisionTallyVendor) => {
      const key = vendorKey(row);
      setVendorCache((prev) => ({
        ...prev,
        [key]: { loading: true, rows: prev[key]?.rows ?? [], error: null },
      }));
      try {
        const params = new URLSearchParams();
        params.set('mode', 'detail');
        params.set('lineKind', 'all');
        params.set('startDate', startDate);
        params.set('endDate', endDate);
        params.set('dateFilterColumn', dateFilterColumn);
        params.set('branch', row.branchId);
        params.set('franchisee', row.franchiseeId);
        if (callType) params.set('callType', callType);
        params.set('page', '1');
        params.set('pageSize', '500');
        const res = await axios.get<{ rows: ArcpProvisionDetailRow[] }>(`${API}?${params}`);
        setVendorCache((prev) => ({
          ...prev,
          [key]: { loading: false, rows: res.data.rows ?? [], error: null },
        }));
      } catch (err) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load lines';
        setVendorCache((prev) => ({
          ...prev,
          [key]: { loading: false, rows: [], error: message },
        }));
      }
    },
    [startDate, endDate, dateFilterColumn, callType]
  );

  const toggleBranch = (branchId: string) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  const toggleVendor = (row: ArcpProvisionTallyVendor) => {
    const key = vendorKey(row);
    setExpandedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      next.add(key);
      return next;
    });
    if (!vendorCache[key]?.rows.length && !vendorCache[key]?.loading) {
      void loadVendorLines(row);
    }
  };

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

  const allBranchesOpen = expandedBranches.size === model.branches.length;
  const expandAllBranches = () =>
    setExpandedBranches(new Set(model.branches.map((b) => b.branchId)));
  const collapseAllBranches = () => {
    setExpandedBranches(new Set());
    setExpandedVendors(new Set());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-slate-100 px-2 py-1">
        <button
          type="button"
          onClick={allBranchesOpen ? collapseAllBranches : expandAllBranches}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
        >
          {allBranchesOpen ? 'Collapse all' : 'Expand all branches'}
        </button>
      </div>
      <AdminTable className="w-full min-w-[1080px] border-collapse text-left">
        <AdminThead>
          <tr className="bg-bg-soft">
            <AdminTh className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
              Branch / Vendor / Call
            </AdminTh>
            <AdminTh className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
              Vendor Code / Detail
            </AdminTh>
            <AdminTh className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}>
              Branch Call Approved
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
              Rate as per CRM
            </AdminTh>
            <AdminTh
              align="right"
              className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            >
              Variance
            </AdminTh>
            <AdminTh
              align="right"
              className={`${cellBorder} text-[11px] tracking-wide text-slate-600`}
            >
              Can add travel amount
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
                >
                  <td className={`${cellBorder} text-[12px] font-semibold text-slate-900`}>
                    <span className="inline-flex items-center gap-1.5">
                      <BranchChevron className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                      {branch.branchName}
                      <span className="text-[10px] font-normal text-slate-500">
                        ({branch.vendors.length} vendor{branch.vendors.length === 1 ? '' : 's'})
                      </span>
                    </span>
                  </td>
                  <td className={`${cellBorder} text-[12px] text-slate-400`}>—</td>
                  <td className={`${cellBorder} text-[12px] text-slate-400`}>—</td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpAmount(branch.rateMst)}
                  </td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpAmount(branch.rateCrm)}
                  </td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpAmount(branch.variance)}
                  </td>
                  <td className={`${numericCell} text-[12px] font-semibold`}>
                    {formatArcpAmount(branch.travelAmount)}
                  </td>
                </tr>

                {branchOpen
                  ? branch.vendors.map((row) => {
                      const key = vendorKey(row);
                      const vendorOpen = expandedVendors.has(key);
                      const VendorChevron = vendorOpen ? ChevronDown : ChevronRight;
                      const cache = vendorCache[key];
                      const mismatch = row.variance != null && Math.abs(row.variance) > 0.01;
                      const serviceRows = (cache?.rows ?? []).filter((r) => !r.is_travel);
                      const travelRows = (cache?.rows ?? []).filter((r) => r.is_travel);

                      return (
                        <Fragment key={key}>
                          <tr
                            className={`cursor-pointer hover:bg-slate-50 ${mismatch ? 'bg-amber-50/80' : ''}`}
                            onClick={() => toggleVendor(row)}
                          >
                            <td className={`${cellBorder} pl-7 text-[12px] text-slate-800`}>
                              <span className="inline-flex items-center gap-1.5">
                                <VendorChevron
                                  className="h-3.5 w-3.5 shrink-0 text-slate-500"
                                  aria-hidden
                                />
                                {row.franchiseeName || '—'}
                              </span>
                            </td>
                            <td className={`${cellBorder} text-[12px] tabular-nums text-slate-700`}>
                              {row.vendorCode || '—'}
                            </td>
                            <td className={`${cellBorder} text-[12px] text-slate-400`}>—</td>
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
                            <td className={`${numericCell} text-[12px]`}>
                              {formatArcpAmount(row.travelAmount)}
                            </td>
                          </tr>

                          {vendorOpen && cache?.loading ? (
                            <tr>
                              <td
                                colSpan={COL_COUNT}
                                className={`${cellBorder} pl-12 py-3 text-[11px] text-slate-500`}
                              >
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Loading lines…
                                </span>
                              </td>
                            </tr>
                          ) : null}

                          {vendorOpen && cache?.error ? (
                            <tr>
                              <td
                                colSpan={COL_COUNT}
                                className={`${cellBorder} pl-12 py-2 text-[11px] text-rose-600`}
                              >
                                {cache.error}
                              </td>
                            </tr>
                          ) : null}

                          {vendorOpen && !cache?.loading && !cache?.error
                            ? serviceRows.map((line) => {
                                const lineMismatch =
                                  line.variance != null && Math.abs(line.variance) > 0.01;
                                return (
                                  <tr
                                    key={`s-${line.ncode}`}
                                    className={lineMismatch ? 'bg-amber-50/50' : 'bg-white'}
                                  >
                                    <td
                                      className={`${cellBorder} pl-12 text-[12px] tabular-nums text-slate-700`}
                                    >
                                      {line.call_no.trim() || '—'}
                                    </td>
                                    <td className={`${cellBorder} text-[11px] text-slate-600`}>
                                      {[line.repair_done, line.item_category, line.local_upcountry]
                                        .filter(Boolean)
                                        .join(' · ') || '—'}
                                      {line.major_minor ? ` · ${line.major_minor}` : ''}
                                    </td>
                                    <td className={`${cellBorder} text-[11px] tabular-nums text-slate-700`}>
                                      {formatExportDate(line.branch_call_approved_at) || '—'}
                                    </td>
                                    <td className={`${numericCell} text-[12px]`}>
                                      {formatArcpRate(line.rate_card_unit)}
                                    </td>
                                    <td className={`${numericCell} text-[12px]`}>
                                      {formatArcpAmount(line.crm_charged)}
                                    </td>
                                    <td
                                      className={`${numericCell} text-[12px] ${lineMismatch ? 'font-semibold text-amber-800' : ''}`}
                                    >
                                      {formatArcpAmount(line.variance)}
                                    </td>
                                    <td className={`${numericCell} text-[12px] text-slate-300`}>
                                      —
                                    </td>
                                  </tr>
                                );
                              })
                            : null}

                          {vendorOpen && !cache?.loading && travelRows.length > 0 ? (
                            <>
                              <tr className="bg-sky-50/80">
                                <td
                                  colSpan={COL_COUNT}
                                  className={`${cellBorder} pl-12 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800`}
                                >
                                  Travel reimbursement (ARCP ntraveltype) —{' '}
                                  {formatArcpAmount(row.travelAmount)}
                                </td>
                              </tr>
                              {travelRows.map((line) => (
                                <tr key={`t-${line.ncode}`} className="bg-sky-50/40">
                                  <td
                                    className={`${cellBorder} pl-12 text-[12px] tabular-nums text-slate-700`}
                                  >
                                    {line.call_no.trim() || '—'}
                                  </td>
                                  <td className={`${cellBorder} text-[11px] text-slate-600`}>
                                    Travel
                                    {line.travel_rate != null
                                      ? ` · rate ${formatArcpRate(line.travel_rate)}`
                                      : ''}
                                  </td>
                                  <td className={`${cellBorder} text-[11px] tabular-nums text-slate-700`}>
                                    {formatExportDate(line.branch_call_approved_at) || '—'}
                                  </td>
                                  <td className={`${numericCell} text-[12px] text-slate-300`}>—</td>
                                  <td className={`${numericCell} text-[12px]`}>
                                    {formatArcpAmount(line.crm_charged)}
                                  </td>
                                  <td className={`${numericCell} text-[12px] text-slate-300`}>—</td>
                                  <td className={`${numericCell} text-[12px]`}>
                                    {formatArcpAmount(line.crm_charged)}
                                  </td>
                                </tr>
                              ))}
                            </>
                          ) : null}

                          {vendorOpen &&
                          !cache?.loading &&
                          !cache?.error &&
                          serviceRows.length === 0 &&
                          travelRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={COL_COUNT}
                                className={`${cellBorder} pl-12 py-2 text-[11px] text-slate-500`}
                              >
                                No lines for this vendor in range.
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
          <tr className="bg-bg-soft font-semibold">
            <td className={`${cellBorder} text-[12px]`} colSpan={3}>
              Grand total
            </td>
            <td className={`${numericCell} text-[12px]`}>
              {formatArcpAmount(model.totals.rateMst)}
            </td>
            <td className={`${numericCell} text-[12px]`}>
              {formatArcpAmount(model.totals.rateCrm)}
            </td>
            <td className={`${numericCell} text-[12px]`}>
              {formatArcpAmount(model.totals.variance)}
            </td>
            <td className={`${numericCell} text-[12px]`}>
              {formatArcpAmount(model.totals.travelAmount)}
            </td>
          </tr>
        </tbody>
      </AdminTable>
    </div>
  );
}
