'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ChevronDown, Copy, Loader2 } from 'lucide-react';
import {
  AdminTable,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { TruncatedText } from '@/components/ui/TruncatedText';
import type {
  WarrantyMasterClientFilters,
  WarrantyMasterHierarchyGroup,
  WarrantyMasterHierarchySubgroup,
  WarrantyMasterHierarchyWarranty,
  WarrantyMasterSerialRow,
} from '@/modules/warranty-master/services';

const TOP_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const SERIAL_PAGE_SIZE = 100;

type Props = {
  rows: WarrantyMasterHierarchySubgroup[];
  filters: WarrantyMasterClientFilters;
};

function formatRange(min: string | null, max: string | null): string {
  if (!min && !max) return '—';
  if (min && max && min !== max) return `${min} → ${max}`;
  return min ?? max ?? '—';
}

function warrantyKey(subgroupKey: string, groupKey: string, months: number): string {
  return `${subgroupKey}::${groupKey}::${months}`;
}

function buildSerialParams(
  subgroup: string,
  groupName: string,
  warrantyMonths: number,
  filters: WarrantyMasterClientFilters,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams({
    mode: 'serials',
    customerSubgroup: subgroup,
    groupKey: groupName,
    rowWarrantyMonths: String(warrantyMonths),
    limit: String(SERIAL_PAGE_SIZE),
    offset: String((page - 1) * SERIAL_PAGE_SIZE),
  });

  if (filters.selectedFgModel.length > 0) {
    params.set('fgModel', filters.selectedFgModel.join(','));
  }
  if (filters.activeOnly) params.set('activeOnly', 'true');
  if (filters.warrEndFrom) params.set('warrEndFrom', filters.warrEndFrom);
  if (filters.warrEndTo) params.set('warrEndTo', filters.warrEndTo);
  return params;
}

function SerialDetail({
  subgroup,
  group,
  warranty,
  filters,
}: {
  subgroup: string;
  group: WarrantyMasterHierarchyGroup;
  warranty: WarrantyMasterHierarchyWarranty;
  filters: WarrantyMasterClientFilters;
}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<WarrantyMasterSerialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [subgroup, group.groupName, warranty.warrantyMonths, filters.selectedFgModel, filters.activeOnly, filters.warrEndFrom, filters.warrEndTo]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);

    const params = buildSerialParams(
      subgroup,
      group.groupName,
      warranty.warrantyMonths,
      filters,
      page,
    );

    fetch(`/api/report/warranty-master?${params.toString()}`, {
      credentials: 'include',
      signal: abort.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(String((body as { error?: string }).error ?? res.statusText));
        }
        return (await res.json()) as { serials?: WarrantyMasterSerialRow[]; total?: number };
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        setRows(data.serials ?? []);
        setTotal(Number(data.total ?? 0));
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load serial numbers');
        setRows([]);
        setTotal(0);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    return () => abort.abort();
  }, [subgroup, group.groupName, warranty.warrantyMonths, filters, page]);

  const totalPages = Math.max(1, Math.ceil(total / SERIAL_PAGE_SIZE));

  const copySerial = async (serial: string) => {
    try {
      await navigator.clipboard.writeText(serial);
      setCopied(serial);
      window.setTimeout(() => setCopied((current) => (current === serial ? null : current)), 1500);
    } catch {
      // Ignore clipboard failures.
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading serial numbers…
      </div>
    );
  }

  if (error) {
    return <div className="px-3 py-4 text-xs text-red-600">{error}</div>;
  }

  return (
    <div className="border-t border-slate-200 bg-white/80 px-2 py-2 sm:px-3">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          {total.toLocaleString('en-IN')} serials
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <button
            type="button"
            className="rounded border border-slate-200 bg-white p-1 disabled:opacity-40"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            aria-label="Previous serial page"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="min-w-[5rem] text-center">Page {page} / {totalPages}</span>
          <button
            type="button"
            className="rounded border border-slate-200 bg-white p-1 disabled:opacity-40"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            aria-label="Next serial page"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      <table className="w-full table-fixed text-left text-[11px]">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[24%]" />
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-100 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            <th className="px-2 py-1.5">Serial No</th>
            <th className="px-2 py-1.5">FG Model</th>
            <th className="px-2 py-1.5">Start</th>
            <th className="px-2 py-1.5">End</th>
            <th className="px-2 py-1.5">Status</th>
            <th className="px-2 py-1.5 text-right">Copy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isCopied = copied === row.serialNo;
            return (
              <tr key={row.serialNo} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono text-[10px] font-semibold text-slate-900">{row.serialNo}</td>
                <td className="px-2 py-1.5 text-slate-700"><TruncatedText text={row.fgModel} /></td>
                <td className="px-2 py-1.5 tabular-nums text-slate-600">{row.warrStartDt ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums text-slate-600">{row.warrEndDt ?? '—'}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${row.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                    {row.isActive ? 'Active' : 'Expired'}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => void copySerial(row.serialNo)}
                    className="inline-flex rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Copy serial number"
                  >
                    {isCopied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const WarrantyMasterHierarchyTable = React.memo(function WarrantyMasterHierarchyTable({ rows, filters }: Props) {
  const [sortAscending, setSortAscending] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [expandedSubgroup, setExpandedSubgroup] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedWarranty, setExpandedWarranty] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    const list = [...rows].sort((a, b) =>
      a.customerSubgroup.localeCompare(b.customerSubgroup, undefined, { sensitivity: 'base', numeric: true })
    );
    if (!sortAscending) list.reverse();
    return list;
  }, [rows, sortAscending]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
    setExpandedSubgroup(null);
    setExpandedGroup(null);
    setExpandedWarranty(null);
  }, [rows, pageSize, filters]);

  const start = sortedRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, sortedRows.length);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-500">
        <span>{start.toLocaleString('en-IN')}–{end.toLocaleString('en-IN')} of {sortedRows.length.toLocaleString('en-IN')} subgroups</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            Rows
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-700"
            >
              {TOP_PAGE_SIZE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button type="button" className="rounded border border-slate-200 bg-white p-1 disabled:opacity-40" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} aria-label="Previous subgroup page">
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="min-w-[4.5rem] text-center">Page {safePage} / {totalPages}</span>
          <button type="button" className="rounded border border-slate-200 bg-white p-1 disabled:opacity-40" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} aria-label="Next subgroup page">
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      <AdminTable className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-8" />
          <col className="w-[48%]" />
          <col className="w-[18%]" />
          <col className="w-[16%]" />
          <col className="w-[18%]" />
        </colgroup>
        <AdminThead>
          <tr>
            <AdminTh className="w-8"><span className="sr-only">Expand</span></AdminTh>
            <AdminTh
              sortable
              sortKey="customer"
              sort={{ key: 'customer', dir: sortAscending ? 'asc' : 'desc' }}
              onSort={() => {
                setSortAscending((value) => !value);
                setPage(1);
              }}
            >
              Customer subgroup
            </AdminTh>
            <AdminTh className="text-right">Machines</AdminTh>
            <AdminTh className="text-right">Groups</AdminTh>
            <AdminTh className="text-right">Warranties</AdminTh>
          </tr>
        </AdminThead>
        <tbody>
          {pagedRows.map((subgroup) => {
            const subgroupOpen = expandedSubgroup === subgroup.subgroupKey;
            const warrantyCount = subgroup.groups.reduce((sum, group) => sum + group.warranties.length, 0);
            return (
              <React.Fragment key={subgroup.subgroupKey}>
                <AdminTr
                  className={`cursor-pointer ${subgroupOpen ? 'bg-slate-50' : 'hover:bg-slate-50/80'}`}
                  onClick={() => {
                    setExpandedSubgroup(subgroupOpen ? null : subgroup.subgroupKey);
                    setExpandedGroup(null);
                    setExpandedWarranty(null);
                  }}
                >
                  <AdminTd className="text-slate-400">
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${subgroupOpen ? '' : '-rotate-90'}`} />
                  </AdminTd>
                  <AdminTd className="font-medium text-slate-800"><TruncatedText text={subgroup.customerSubgroup} /></AdminTd>
                  <AdminTd className="text-right tabular-nums font-semibold text-slate-900">{subgroup.machineCount.toLocaleString('en-IN')}</AdminTd>
                  <AdminTd className="text-right tabular-nums text-slate-600">{subgroup.groups.length}</AdminTd>
                  <AdminTd className="text-right tabular-nums text-slate-600">{warrantyCount}</AdminTd>
                </AdminTr>

                {subgroupOpen ? (
                  <AdminTr>
                    <td colSpan={5} className="bg-slate-50 p-0">
                      <div className="border-t border-slate-200 pl-5 pr-2 py-2">
                        <table className="w-full table-fixed text-left">
                          <colgroup>
                            <col className="w-8" />
                            <col />
                            <col className="w-28" />
                            <col className="w-24" />
                          </colgroup>
                          <thead>
                            <tr className="border-b border-slate-200 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                              <th></th>
                              <th className="px-2 py-1.5">Group</th>
                              <th className="px-2 py-1.5 text-right">Machines</th>
                              <th className="px-2 py-1.5 text-right">Warranties</th>
                            </tr>
                          </thead>
                          <tbody>
                            {subgroup.groups.map((group) => {
                              const groupKey = `${subgroup.subgroupKey}::${group.groupKey}`;
                              const groupOpen = expandedGroup === groupKey;
                              return (
                                <React.Fragment key={groupKey}>
                                  <tr
                                    className={`cursor-pointer border-b border-slate-100 ${groupOpen ? 'bg-white' : 'hover:bg-white'}`}
                                    onClick={() => {
                                      setExpandedGroup(groupOpen ? null : groupKey);
                                      setExpandedWarranty(null);
                                    }}
                                  >
                                    <td className="px-2 py-1.5 text-slate-400">
                                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${groupOpen ? '' : '-rotate-90'}`} />
                                    </td>
                                    <td className="px-2 py-1.5 font-medium text-slate-700">{group.groupName}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800">{group.machineCount.toLocaleString('en-IN')}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{group.warranties.length}</td>
                                  </tr>

                                  {groupOpen ? (
                                    <tr>
                                      <td colSpan={4} className="bg-white p-0">
                                        <div className="border-y border-slate-100 px-2 py-2 pl-8">
                                          <table className="w-full table-fixed text-left">
                                            <colgroup>
                                              <col className="w-8" />
                                              <col />
                                              <col className="w-28" />
                                              <col className="w-44" />
                                            </colgroup>
                                            <thead>
                                              <tr className="border-b border-slate-100 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                                                <th></th>
                                                <th className="px-2 py-1.5">Warranty</th>
                                                <th className="px-2 py-1.5 text-right">Machines</th>
                                                <th className="px-2 py-1.5 text-right">End date range</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {group.warranties.map((warranty) => {
                                                const key = warrantyKey(subgroup.subgroupKey, group.groupKey, warranty.warrantyMonths);
                                                const warrantyOpen = expandedWarranty === key;
                                                return (
                                                  <React.Fragment key={key}>
                                                    <tr
                                                      className={`cursor-pointer border-b border-slate-50 ${warrantyOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                                                      onClick={() => setExpandedWarranty(warrantyOpen ? null : key)}
                                                    >
                                                      <td className="px-2 py-1.5 text-slate-400">
                                                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${warrantyOpen ? '' : '-rotate-90'}`} />
                                                      </td>
                                                      <td className="px-2 py-1.5 font-medium text-slate-700">{warranty.warrantyMonths} months</td>
                                                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800">{warranty.machineCount.toLocaleString('en-IN')}</td>
                                                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{formatRange(warranty.minWarrEnd, warranty.maxWarrEnd)}</td>
                                                    </tr>
                                                    {warrantyOpen ? (
                                                      <tr>
                                                        <td colSpan={4} className="p-0">
                                                          <SerialDetail
                                                            subgroup={subgroup.customerSubgroup}
                                                            group={group}
                                                            warranty={warranty}
                                                            filters={filters}
                                                          />
                                                        </td>
                                                      </tr>
                                                    ) : null}
                                                  </React.Fragment>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  ) : null}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </AdminTr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </AdminTable>
    </div>
  );
});
