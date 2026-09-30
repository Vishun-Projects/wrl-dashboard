'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { GlossaryTerm } from '@/components/ui/GlossaryTerm';
import { PageAlert } from '@/components/ui/PageAlert';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { defaultDateRange, toDateString, type ReportDateRange } from '@/modules/mis';
import { ArcpProvisionTallyTable } from '@/modules/arcp-provision/components/ArcpProvisionTallyTable';
import { ArcpProvisionSummaryTable } from '@/modules/arcp-provision/components/ArcpProvisionSummaryTable';
import {
  buildArcpProvisionSummaryTableModel,
  buildArcpProvisionTableModel,
} from '@/modules/arcp-provision/services/table';
import type {
  ArcpProvisionAggregateRow,
  ArcpProvisionCategoryAggregateRow,
  ArcpProvisionOptions,
  ArcpProvisionSummary,
} from '@/modules/arcp-provision/types';
import { feedback } from '@/lib/ui/feedback';

const API = '/api/report/arcp-provision';

type ViewMode = 'summary' | 'detail';

function summarizeFromVendor(rows: ArcpProvisionAggregateRow[]): ArcpProvisionSummary {
  let qty = 0;
  let rateMst = 0;
  let rateCrm = 0;
  let travelAmount = 0;
  let unmatchedQty = 0;
  for (const row of rows) {
    qty += row.qty;
    rateCrm += row.rate_crm;
    travelAmount += row.travel_amount;
    if (row.rate_mst == null) unmatchedQty += row.qty;
    else rateMst += row.rate_mst;
  }
  return {
    qty,
    rateMst,
    rateCrm,
    variance: rateCrm - rateMst,
    travelAmount,
    unmatchedQty,
  };
}

function summarizeFromCategory(rows: ArcpProvisionCategoryAggregateRow[]): ArcpProvisionSummary {
  let qty = 0;
  let rateMst = 0;
  let rateCrm = 0;
  let travelAmount = 0;
  let unmatchedQty = 0;
  for (const row of rows) {
    qty += row.qty;
    rateCrm += row.rate_crm;
    travelAmount += row.travel_amount;
    if (row.rate_mst == null) unmatchedQty += row.qty;
    else rateMst += row.rate_mst;
  }
  return {
    qty,
    rateMst,
    rateCrm,
    variance: rateCrm - rateMst,
    travelAmount,
    unmatchedQty,
  };
}

const DATE_BASIS_OPTIONS: FilterSelectOption[] = [
  { value: 'source_editedon', label: 'Branch Call Approved' },
  { value: 'bm_approved_at', label: 'BM Call Approved' },
  { value: 'dcalllogdatetime', label: 'Call Date' },
  { value: 'dsolveddatetime', label: 'Call Solve Date' },
];

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

function buildParams(opts: {
  startDate: string;
  endDate: string;
  dateFilterColumn: string;
  branch: string;
  franchisee: string;
  callType: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('startDate', opts.startDate);
  params.set('endDate', opts.endDate);
  params.set('dateFilterColumn', opts.dateFilterColumn);
  if (opts.branch) params.set('branch', opts.branch);
  if (opts.franchisee) params.set('franchisee', opts.franchisee);
  if (opts.callType) params.set('callType', opts.callType);
  return params;
}

export default function ArcpProvisionPageClient() {
  const [dateRange, setDateRange] = useState<ReportDateRange>(() => defaultDateRange());
  const startDate = useMemo(() => toDateString(dateRange.start), [dateRange.start]);
  const endDate = useMemo(() => toDateString(dateRange.end), [dateRange.end]);
  const [dateFilterColumn, setDateFilterColumn] = useState('source_editedon');
  const [branch, setBranch] = useState('');
  const [franchisee, setFranchisee] = useState('');
  const [callType, setCallType] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [options, setOptions] = useState<ArcpProvisionOptions | null>(null);
  const [vendorAggregates, setVendorAggregates] = useState<ArcpProvisionAggregateRow[]>([]);
  const [categoryAggregates, setCategoryAggregates] = useState<
    ArcpProvisionCategoryAggregateRow[]
  >([]);
  const [summary, setSummary] = useState<ArcpProvisionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailModel = useMemo(
    () => buildArcpProvisionTableModel(vendorAggregates),
    [vendorAggregates]
  );
  const summaryModel = useMemo(
    () => buildArcpProvisionSummaryTableModel(categoryAggregates),
    [categoryAggregates]
  );

  const branchOptions = useMemo<FilterSelectOption[]>(
    () => (options?.branches ?? []).map((b) => ({ value: b.value, label: b.label })),
    [options]
  );
  const franchiseeOptions = useMemo<FilterSelectOption[]>(
    () => (options?.franchisees ?? []).map((f) => ({ value: f.value, label: f.label })),
    [options]
  );
  const callTypeOptions = useMemo<FilterSelectOption[]>(
    () => (options?.callTypes ?? []).map((t) => ({ value: t, label: t })),
    [options]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = {
        startDate,
        endDate,
        dateFilterColumn,
        branch,
        franchisee,
        callType,
      };
      const optsParams = buildParams({ ...base, branch: '', franchisee: '', callType: '' });
      optsParams.set('mode', 'options');
      const dataMode = viewMode === 'summary' ? 'category-aggregates' : 'aggregates';
      const [optsRes, dataRes] = await Promise.all([
        axios.get<ArcpProvisionOptions>(`${API}?${optsParams}`),
        axios.get<{
          aggregates: ArcpProvisionAggregateRow[] | ArcpProvisionCategoryAggregateRow[];
        }>(`${API}?${buildParams(base)}&mode=${dataMode}`),
      ]);
      setOptions(optsRes.data);
      if (viewMode === 'summary') {
        const rows = (dataRes.data.aggregates ?? []) as ArcpProvisionCategoryAggregateRow[];
        setCategoryAggregates(rows);
        setSummary(summarizeFromCategory(rows));
      } else {
        const rows = (dataRes.data.aggregates ?? []) as ArcpProvisionAggregateRow[];
        setVendorAggregates(rows);
        setSummary(summarizeFromVendor(rows));
      }
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Failed to load ARCP provision';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, dateFilterColumn, branch, franchisee, callType, viewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const onExport = async () => {
    setExporting(true);
    try {
      const params = buildParams({
        startDate,
        endDate,
        dateFilterColumn,
        branch,
        franchisee,
        callType,
      });
      params.set('format', 'csv');
      const res = await axios.get(`${API}?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'arcp-provision.csv';
      a.click();
      URL.revokeObjectURL(url);
      feedback.actionSuccess('CSV downloaded');
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const toolbar = (
    <div className="relative z-20 border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
      <div className="report-toolbar-filters-row arcp-claims-toolbar-row">
        <FilterSelect
          label="Date basis"
          emptyLabel="Date basis"
          options={DATE_BASIS_OPTIONS}
          selected={dateFilterColumn ? [dateFilterColumn] : ['source_editedon']}
          mode="single"
          layout="inline"
          panelClassName="w-64"
          onChange={(vals) => setDateFilterColumn(pickSingle(vals) || 'source_editedon')}
        />
        <div className="report-toolbar-filters-date shrink-0">
          <DateRangeSelector
            value={dateRange.label}
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={setDateRange}
          />
        </div>
        <FilterSelect
          label="Branch"
          emptyLabel="All branches"
          options={branchOptions}
          selected={branch ? [branch] : []}
          mode="single"
          layout="inline"
          panelClassName="w-72"
          onChange={(vals) => setBranch(pickSingle(vals))}
        />
        <FilterSelect
          label="Franchisee"
          emptyLabel="All franchisees"
          options={franchiseeOptions}
          selected={franchisee ? [franchisee] : []}
          mode="single"
          layout="inline"
          panelClassName="w-72"
          onChange={(vals) => setFranchisee(pickSingle(vals))}
        />
        <FilterSelect
          label="Call type"
          emptyLabel="All call types"
          options={callTypeOptions}
          selected={callType ? [callType] : []}
          mode="single"
          layout="inline"
          panelClassName="w-64"
          onChange={(vals) => setCallType(pickSingle(vals))}
        />
      </div>
    </div>
  );

  const isEmpty =
    !loading &&
    (viewMode === 'summary'
      ? summaryModel.branches.length === 0
      : detailModel.branches.length === 0);

  return (
    <PageShell
      title={
        <span className="inline-flex items-center gap-1">
          <GlossaryTerm term="ARCP" showIcon={false} />
          {' Provision'}
        </span>
      }
      subtitle={
        viewMode === 'summary'
          ? 'Summary — branch totals, expand for Claims-style category tally'
          : 'Detail — branch → vendor → call lines'
      }
      icon={<FileSpreadsheet className="h-4 w-4" />}
      actions={
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={loading || exporting}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          CSV
        </button>
      }
      toolbar={toolbar}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-bg-canvas px-3 pt-2 pb-2">
        {error ? (
          <PageAlert variant="error" message={error} onDismiss={() => setError(null)} />
        ) : null}
        {summary ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Qty</p>
              <p className="text-lg font-semibold tabular-nums">{summary.qty}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Rate as per Mst.</p>
              <p className="text-lg font-semibold tabular-nums">
                {summary.rateMst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Rate as per CRM</p>
              <p className="text-lg font-semibold tabular-nums">
                {summary.rateCrm.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Variance</p>
              <p className="text-lg font-semibold tabular-nums">
                {summary.variance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Travel</p>
              <p className="text-lg font-semibold tabular-nums">
                {summary.travelAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
            View
          </span>
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-slate-200 bg-bg-soft p-0.5">
            {(
              [
                { value: 'summary', label: 'Summary' },
                { value: 'detail', label: 'Detail' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setViewMode(opt.value)}
                className={`whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  viewMode === opt.value
                    ? 'bg-bg-canvas text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PageScrollRegion>
        <div className="flex min-h-0 flex-1 flex-col">
          <AdminTableCard
            isEmpty={isEmpty}
            empty={
              <>
                <p className="text-sm font-medium text-slate-600">No provision lines</p>
                <p className="text-[11px] text-slate-400">
                  No ARCP service lines match this date range and filters (cancelled calls excluded).
                </p>
              </>
            }
          >
            {viewMode === 'summary' ? (
              <ArcpProvisionSummaryTable model={summaryModel} loading={loading} />
            ) : (
              <ArcpProvisionTallyTable
                key={`${startDate}|${endDate}|${dateFilterColumn}|${branch}|${franchisee}|${callType}`}
                model={detailModel}
                loading={loading}
                startDate={startDate}
                endDate={endDate}
                dateFilterColumn={dateFilterColumn}
                callType={callType}
              />
            )}
          </AdminTableCard>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
