'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { AdminTable, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { toDateString, type ReportDateRange } from '@/modules/mis';
import { feedback } from '@/lib/ui/feedback';
import { formatUiDate } from '@/lib/dates/ui-date';
import type {
  WarrantyProvisionOptions,
  WarrantyProvisionRow,
  WarrantyProvisionRowsResponse,
} from '@/modules/warranty-provision/types';

const API = '/api/report/warranty-provision';
const PAGE_SIZES = [100, 250, 500, 1000] as const;

const ALL_TIME: ReportDateRange = {
  start: new Date(0),
  end: new Date(),
  label: 'All Time',
};

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

function toOpts(values: string[]): FilterSelectOption[] {
  return values.map((v) => ({ value: v, label: v }));
}

function loanBounds(range: ReportDateRange): { from: string; to: string } {
  if (range.label === 'All Time' || range.start.getTime() === 0) {
    return { from: '', to: '' };
  }
  return { from: toDateString(range.start), to: toDateString(range.end) };
}

export default function WarrantyProvisionPageClient() {
  const [dateRange, setDateRange] = useState<ReportDateRange>(() => ALL_TIME);
  const { from: billingFrom, to: billingTo } = useMemo(
    () => loanBounds(dateRange),
    [dateRange]
  );

  const [materialGroup, setMaterialGroup] = useState('');
  const [customerSubgroup, setCustomerSubgroup] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [material, setMaterial] = useState('');
  const [warrantyRemaining, setWarrantyRemaining] = useState('');
  const [warrantyEndFy, setWarrantyEndFy] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(100);

  const [options, setOptions] = useState<WarrantyProvisionOptions>({
    materialGroups: [],
    customerSubgroups: [],
    states: [],
    cities: [],
    materials: [],
    warrantyRemainingDays: [],
    warrantyEndFys: [],
  });
  const [rowsData, setRowsData] = useState<WarrantyProvisionRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const resetPage = useCallback(() => setPage(1), []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API}?mode=options`, { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as WarrantyProvisionOptions;
        setOptions(data);
      } catch {
        /* options best-effort */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'rows');
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (materialGroup) params.set('materialGroups', materialGroup);
      if (customerSubgroup) params.set('customerSubgroups', customerSubgroup);
      if (state) params.set('states', state);
      if (city) params.set('cities', city);
      if (material) params.set('materials', material);
      if (warrantyRemaining) params.set('warrantyRemainingDays', warrantyRemaining);
      if (warrantyEndFy) params.set('warrantyEndFys', warrantyEndFy);
      if (q.trim()) params.set('q', q.trim());
      if (billingFrom) params.set('billingFrom', billingFrom);
      if (billingTo) params.set('billingTo', billingTo);

      const res = await fetch(`${API}?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to load rows');
      }
      setRowsData((await res.json()) as WarrantyProvisionRowsResponse);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    materialGroup,
    customerSubgroup,
    state,
    city,
    material,
    warrantyRemaining,
    warrantyEndFy,
    q,
    billingFrom,
    billingTo,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: WarrantyProvisionRow[] = rowsData?.rows ?? [];
  const total = rowsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PageShell
      title="Warranty Provision"
      subtitle="SAP warranty provision workbook"
      icon={<Shield className="h-4 w-4" />}
      toolbar={
        <div className="register-filter-bar border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
          <div className="flex w-full flex-wrap items-end gap-2">
            <div className="report-toolbar-filters-date shrink-0">
              <DateRangeSelector
                value={dateRange.label}
                startDate={dateRange.start}
                endDate={dateRange.end}
                includeAllTime
                onChange={(range) => {
                  resetPage();
                  setDateRange(range);
                }}
              />
            </div>
            <FilterSelect
              label="Material Group"
              emptyLabel="All groups"
              options={toOpts(options.materialGroups)}
              selected={materialGroup ? [materialGroup] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setMaterialGroup(pickSingle(values));
              }}
              searchPlaceholder="Search…"
              panelClassName="w-56"
              layout="inline"
            />
            <FilterSelect
              label="Customer Subgroup"
              emptyLabel="All subgroups"
              options={toOpts(options.customerSubgroups)}
              selected={customerSubgroup ? [customerSubgroup] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setCustomerSubgroup(pickSingle(values));
              }}
              searchPlaceholder="Search…"
              panelClassName="w-56"
              layout="inline"
            />
            <FilterSelect
              label="State"
              emptyLabel="All states"
              options={toOpts(options.states)}
              selected={state ? [state] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setState(pickSingle(values));
              }}
              searchPlaceholder="Search…"
              panelClassName="w-52"
              layout="inline"
            />
            <FilterSelect
              label="City"
              emptyLabel="All cities"
              options={toOpts(options.cities)}
              selected={city ? [city] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setCity(pickSingle(values));
              }}
              searchPlaceholder="Search…"
              panelClassName="w-52"
              layout="inline"
            />
            <FilterSelect
              label="Material"
              emptyLabel="All materials"
              options={toOpts(options.materials)}
              selected={material ? [material] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setMaterial(pickSingle(values));
              }}
              searchPlaceholder="Search…"
              panelClassName="w-56"
              layout="inline"
            />
            <FilterSelect
              label="Warranty remaining"
              emptyLabel="All"
              options={toOpts(options.warrantyRemainingDays)}
              selected={warrantyRemaining ? [warrantyRemaining] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setWarrantyRemaining(pickSingle(values));
              }}
              panelClassName="w-44"
              layout="inline"
            />
            <FilterSelect
              label="Warranty end FY"
              emptyLabel="All FY"
              options={toOpts(options.warrantyEndFys)}
              selected={warrantyEndFy ? [warrantyEndFy] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setWarrantyEndFy(pickSingle(values));
              }}
              panelClassName="w-40"
              layout="inline"
            />
            <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
              Search
              <input
                value={q}
                onChange={(e) => {
                  resetPage();
                  setQ(e.target.value);
                }}
                placeholder="Billing / serial / party…"
                className="h-8 w-48 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800"
              />
            </label>
            <span className="self-end pb-1 text-[12px] text-slate-500">
              {loading ? 'Loading…' : `${total.toLocaleString()} row(s)`}
            </span>
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-bg-canvas custom-scrollbar">
          <AdminTable className="w-full min-w-max border-collapse text-left">
            <AdminThead>
              <tr>
                <AdminTh>Billing Document</AdminTh>
                <AdminTh>Billing Date</AdminTh>
                <AdminTh>Material</AdminTh>
                <AdminTh>Serial Number</AdminTh>
                <AdminTh>Material Group</AdminTh>
                <AdminTh>External Material Group</AdminTh>
                <AdminTh>Sold-To Party</AdminTh>
                <AdminTh>Customer Subgroup</AdminTh>
                <AdminTh>Ship-To Party</AdminTh>
                <AdminTh>State</AdminTh>
                <AdminTh>City</AdminTh>
                <AdminTh>Inventory Number</AdminTh>
                <AdminTh>Warranty</AdminTh>
                <AdminTh>Warranty End</AdminTh>
                <AdminTh align="right">Days</AdminTh>
                <AdminTh align="right">Remaining Days</AdminTh>
                <AdminTh>Warranty Remaining</AdminTh>
                <AdminTh>Warranty End FY</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {loading ? (
                <AdminTr>
                  <td className="px-4 py-3 text-[12px] text-slate-500" colSpan={18}>
                    Loading…
                  </td>
                </AdminTr>
              ) : rows.length === 0 ? (
                <AdminTr>
                  <td className="px-4 py-8 text-center text-[12px] text-slate-500" colSpan={18}>
                    No warranty provision rows match the current filters
                  </td>
                </AdminTr>
              ) : (
                rows.map((r) => (
                  <AdminTr key={r.id}>
                    <AdminTd className="font-mono text-[11px]">{r.billingDocument}</AdminTd>
                    <AdminTd>{r.billingDate ? formatUiDate(r.billingDate) : '—'}</AdminTd>
                    <AdminTd>{r.material}</AdminTd>
                    <AdminTd className="font-mono text-[11px]">{r.serialNumber}</AdminTd>
                    <AdminTd>{r.materialGroup || '—'}</AdminTd>
                    <AdminTd>{r.externalMaterialGroup || '—'}</AdminTd>
                    <AdminTd className="max-w-[14rem] truncate" title={r.soldToPartyName}>
                      {r.soldToPartyName || '—'}
                    </AdminTd>
                    <AdminTd>{r.customerSubgroup || '—'}</AdminTd>
                    <AdminTd className="max-w-[14rem] truncate" title={r.shipToPartyName}>
                      {r.shipToPartyName || '—'}
                    </AdminTd>
                    <AdminTd>{r.shipToPartyState || '—'}</AdminTd>
                    <AdminTd>{r.shipToPartyCity || '—'}</AdminTd>
                    <AdminTd className="font-mono text-[11px]">{r.inventoryNumber || '—'}</AdminTd>
                    <AdminTd>{r.warrantyStart ? formatUiDate(r.warrantyStart) : '—'}</AdminTd>
                    <AdminTd>{r.warrantyEndDate ? formatUiDate(r.warrantyEndDate) : '—'}</AdminTd>
                    <AdminTd align="right">{r.days ?? '—'}</AdminTd>
                    <AdminTd align="right">{r.remainingDays ?? '—'}</AdminTd>
                    <AdminTd>{r.warrantyRemainingDays || '—'}</AdminTd>
                    <AdminTd>{r.warrantyEndFy || '—'}</AdminTd>
                  </AdminTr>
                ))
              )}
            </tbody>
          </AdminTable>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-1 pb-1 text-[12px] text-slate-600">
          <label className="flex items-center gap-1.5">
            Rows
            <select
              value={pageSize}
              onChange={(e) => {
                resetPage();
                setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
              }}
              className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[12px] text-slate-700"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
