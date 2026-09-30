'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { AdminTable, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { useTableSort } from '@/lib/ui/table-sort';
import { feedback } from '@/lib/ui/feedback';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { toDateString, type ReportDateRange } from '@/modules/mis';
import { gzipBlobForMisUpload } from '@/modules/mis/client-import/services/upload-gzip';
import { branchFileLabel } from '@/modules/spare-loan-check/export-labels';
import type {
  Zss02ImportMeta,
  Zss02ImportResponse,
  Zss02OptionsResponse,
  Zss02Row,
  Zss02RowsResponse,
} from '@/modules/zss02/types';

const API = '/api/report/zss02';

const ALL_TIME: ReportDateRange = {
  start: new Date(0),
  end: new Date(),
  label: 'All Time',
};

type FilterState = {
  plant: string;
  vendor: string;
  itemGroup: string;
  material: string;
  barcode: string;
  loanRange: ReportDateRange;
};

type SortKey =
  | 'plant'
  | 'vendorNo'
  | 'vendorName'
  | 'itemGroup'
  | 'material'
  | 'materialDescription'
  | 'barcode'
  | 'soConRtn'
  | 'soLoan'
  | 'loanDate'
  | 'loanRtnDate'
  | 'cnsmpDate'
  | 'noCnsmpCount'
  | 'saleDate'
  | 'saleRtnDate';

const EMPTY_FILTERS: FilterState = {
  plant: '',
  vendor: '',
  itemGroup: '',
  material: '',
  barcode: '',
  loanRange: ALL_TIME,
};

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

function loanBounds(range: ReportDateRange): { loanFrom: string; loanTo: string } {
  if (range.label === 'All Time') return { loanFrom: '', loanTo: '' };
  return { loanFrom: toDateString(range.start), loanTo: toDateString(range.end) };
}

/** SAP DD.MM.YYYY → YYYYMMDD for sort; blank / invalid stay empty (sort last). */
function sapDateSortKey(raw: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.replace(/\s+/g, '').trim());
  if (!m) return '';
  return `${m[3]}${m[2]}${m[1]}`;
}

async function readApiJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(snippet || `Request failed (${res.status})`);
  }
}

function IssueCell({
  issue,
  detail,
}: {
  issue: 'cancelled' | 'franchisee_change' | null;
  detail: string | null;
}) {
  if (issue === 'cancelled') {
    return (
      <span title={detail || 'Cancelled'} className="inline-flex text-rose-600">
        <Ban className="h-4 w-4" aria-label="Cancelled" />
      </span>
    );
  }
  if (issue === 'franchisee_change') {
    return (
      <span title={detail || 'Franchisee changed'} className="inline-flex text-amber-600">
        <AlertTriangle className="h-4 w-4" aria-label="Franchisee changed" />
      </span>
    );
  }
  return <span className="text-slate-300">—</span>;
}

function sortValue(row: Zss02Row, key: SortKey): unknown {
  switch (key) {
    case 'plant':
      return branchFileLabel(row.plant, row.plantName);
    case 'vendorNo':
      return row.vendorNo;
    case 'vendorName':
      return row.vendorName;
    case 'itemGroup':
      return row.itemGroup;
    case 'material':
      return row.material;
    case 'materialDescription':
      return row.materialDescription;
    case 'barcode':
      return row.barcode;
    case 'soConRtn':
      return row.soConRtn;
    case 'soLoan':
      return row.soLoan;
    case 'loanDate':
      return sapDateSortKey(row.loanDate);
    case 'loanRtnDate':
      return sapDateSortKey(row.loanRtnDate);
    case 'cnsmpDate':
      return sapDateSortKey(row.cnsmpDate);
    case 'noCnsmpCount':
      return row.noCnsmpCount;
    case 'saleDate':
      return sapDateSortKey(row.saleDate);
    case 'saleRtnDate':
      return sapDateSortKey(row.saleRtnDate);
    default:
      return null;
  }
}

export default function Zss02PageClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('Importing…');
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(false);

  const [imports, setImports] = useState<Zss02ImportMeta[]>([]);
  const [options, setOptions] = useState<Zss02OptionsResponse>({
    plants: [],
    vendors: [],
    itemGroups: [],
    materials: [],
    latestLoanDate: null,
  });
  const [rowsData, setRowsData] = useState<Zss02RowsResponse | null>(null);

  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const pageSize = 50;
  const { sort, onSort, sorted } = useTableSort<SortKey>(null);

  const appliedBounds = useMemo(() => loanBounds(applied.loanRange), [applied.loanRange]);

  const refreshMeta = useCallback(async () => {
    const [impRes, optRes] = await Promise.all([
      fetch(`${API}?mode=imports`, { credentials: 'include' }),
      fetch(`${API}?mode=options`, { credentials: 'include' }),
    ]);
    const impData = await readApiJson(impRes);
    const optData = await readApiJson(optRes);
    if (!impRes.ok) throw new Error(String(impData.error || 'Failed to load imports'));
    if (!optRes.ok) throw new Error(String(optData.error || 'Failed to load options'));
    setImports((impData.imports as Zss02ImportMeta[]) ?? []);
    setOptions(optData as unknown as Zss02OptionsResponse);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'rows');
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (applied.plant) params.set('plants', applied.plant);
      if (applied.vendor) params.set('vendors', applied.vendor);
      if (applied.itemGroup) params.set('itemGroups', applied.itemGroup);
      if (applied.material) params.set('materials', applied.material);
      if (applied.barcode) params.set('barcode', applied.barcode);
      if (appliedBounds.loanFrom) params.set('loanFrom', appliedBounds.loanFrom);
      if (appliedBounds.loanTo) params.set('loanTo', appliedBounds.loanTo);
      const res = await fetch(`${API}?${params}`, { credentials: 'include' });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(String(data.error || 'Failed to load rows'));
      setRowsData(data as unknown as Zss02RowsResponse);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load rows');
      setRowsData(null);
    } finally {
      setLoading(false);
    }
  }, [page, applied, appliedBounds, reloadToken]);

  useEffect(() => {
    void (async () => {
      try {
        await refreshMeta();
      } catch (err) {
        feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load');
      }
    })();
  }, [refreshMeta]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function applyFilters() {
    setPage(1);
    setApplied({
      ...draft,
      barcode: draft.barcode.trim(),
    });
  }

  async function exportExcel() {
    if (exporting || uploading) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'export');
      if (applied.plant) params.set('plants', applied.plant);
      if (applied.vendor) params.set('vendors', applied.vendor);
      if (applied.itemGroup) params.set('itemGroups', applied.itemGroup);
      if (applied.material) params.set('materials', applied.material);
      if (applied.barcode) params.set('barcode', applied.barcode);
      if (appliedBounds.loanFrom) params.set('loanFrom', appliedBounds.loanFrom);
      if (appliedBounds.loanTo) params.set('loanTo', appliedBounds.loanTo);
      const res = await fetch(`${API}?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await readApiJson(res);
        throw new Error(String(data.error || `Export failed (${res.status})`));
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match?.[1] || 'ZSS02.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (res.headers.get('X-ZSS02-Export-Truncated') === '1') {
        feedback.actionWarning('Export capped at 100,000 rows — narrow filters for a full file');
      } else {
        feedback.actionSuccess('Excel downloaded');
      }
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = [...fileList];
    setUploading(true);
    try {
      let totalParsed = 0;
      let totalSkipped = 0;
      const plants = new Set<string>();
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        setUploadLabel(`Importing ${i + 1}/${files.length}…`);
        const { blob: wireBlob, encoding } = await gzipBlobForMisUpload(file);
        const form = new FormData();
        form.set('file', wireBlob, file.name);
        form.set('fileName', file.name);
        if (encoding) form.set('contentEncoding', encoding);
        const res = await fetch(API, { method: 'POST', body: form, credentials: 'include' });
        const data = await readApiJson(res);
        if (!res.ok) {
          const rawErr = String(data.error || `Import failed (${res.status})`);
          if (
            res.status === 413 ||
            /payload.?too.?large|entity too large|function_payload/i.test(rawErr)
          ) {
            throw new Error(
              'File still too large after compression. Split the SAP report by plant and upload separately.'
            );
          }
          throw new Error(rawErr);
        }
        const result = data as unknown as Zss02ImportResponse;
        for (const imp of result.imports ?? []) {
          totalParsed += imp.parsed;
          totalSkipped += imp.skipped;
          for (const p of imp.plantsOverwritten ?? []) plants.add(p);
        }
      }
      feedback.actionSuccess(
        `Imported ${totalParsed.toLocaleString()} row(s)` +
          (plants.size ? ` · overwrote ${plants.size} plant(s)` : '') +
          (totalSkipped ? ` · ${totalSkipped.toLocaleString()} out of scope skipped` : '')
      );
      setPage(1);
      await refreshMeta();
      setReloadToken((n) => n + 1);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
      setUploadLabel('Importing…');
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const plantOpts: FilterSelectOption[] = options.plants;
  const vendorOpts: FilterSelectOption[] = options.vendors;
  const itemGroupOpts: FilterSelectOption[] = options.itemGroups;
  const materialOpts: FilterSelectOption[] = options.materials;

  const total = rowsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rows = useMemo(
    () => sorted(rowsData?.rows ?? [], sortValue),
    [rowsData?.rows, sorted]
  );
  const subtitle = options.latestLoanDate
    ? `Details as on ${options.latestLoanDate}`
    : 'Upload SAP ZSS02 HTML — re-upload overwrites those plants';

  return (
    <PageShell
      title="ZSS02"
      subtitle={subtitle}
      icon={<FileSpreadsheet className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void exportExcel()}
            disabled={exporting || uploading || loading || total === 0}
            title="Export applied filters to Excel"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".htm,.html,text/html"
            multiple
            className="hidden"
            onChange={(e) => void uploadFiles(e.target.files)}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || exporting}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? uploadLabel : 'Import ZSS02 HTML'}
          </button>
        </div>
      }
      toolbar={
        <div className="register-filter-bar border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
          <div className="report-toolbar-filters-row items-end">
            <div className="report-toolbar-filters-date shrink-0">
              <DateRangeSelector
                value={draft.loanRange.label}
                startDate={draft.loanRange.start}
                endDate={draft.loanRange.end}
                includeAllTime
                onChange={(range) => setDraft((d) => ({ ...d, loanRange: range }))}
              />
            </div>
            <FilterSelect
              label="Plant"
              emptyLabel="All plants"
              options={plantOpts}
              selected={draft.plant ? [draft.plant] : []}
              mode="single"
              onChange={(values) => setDraft((d) => ({ ...d, plant: pickSingle(values) }))}
              searchPlaceholder="Search plant…"
              panelClassName="w-72"
              layout="inline"
            />
            <FilterSelect
              label="Vendor"
              emptyLabel="All vendors"
              options={vendorOpts}
              selected={draft.vendor ? [draft.vendor] : []}
              mode="single"
              onChange={(values) => setDraft((d) => ({ ...d, vendor: pickSingle(values) }))}
              searchPlaceholder="Search vendor…"
              panelClassName="w-80"
              layout="inline"
            />
            <FilterSelect
              label="Item Group"
              emptyLabel="All item groups"
              options={itemGroupOpts}
              selected={draft.itemGroup ? [draft.itemGroup] : []}
              mode="single"
              onChange={(values) => setDraft((d) => ({ ...d, itemGroup: pickSingle(values) }))}
              searchPlaceholder="Search item group…"
              panelClassName="w-72"
              layout="inline"
            />
            <FilterSelect
              label="Material"
              emptyLabel="All materials"
              options={materialOpts}
              selected={draft.material ? [draft.material] : []}
              mode="single"
              onChange={(values) => setDraft((d) => ({ ...d, material: pickSingle(values) }))}
              searchPlaceholder="Search material…"
              panelClassName="w-80"
              layout="inline"
            />
            <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
              Barcode
              <textarea
                value={draft.barcode}
                onChange={(e) => setDraft((d) => ({ ...d, barcode: e.target.value }))}
                placeholder={'One per line\n222…\n241…'}
                rows={3}
                className="w-44 resize-y rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] leading-snug text-slate-800"
              />
            </label>
            <button
              type="button"
              className="inline-flex h-8 items-center self-end rounded-md bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              onClick={applyFilters}
              disabled={loading || uploading}
            >
              Apply filters
            </button>
            <span className="ml-auto shrink-0 self-end pb-1 text-[12px] text-slate-500">
              {loading ? 'Loading…' : `${total.toLocaleString()} row(s)`}
            </span>
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
          <AdminTable className="w-full min-w-max border-collapse text-left">
            <AdminThead>
              <tr>
                <AdminTh className="w-10"> </AdminTh>
                <AdminTh sortable sortKey="plant" sort={sort} onSort={onSort}>
                  Plant
                </AdminTh>
                <AdminTh sortable sortKey="vendorNo" sort={sort} onSort={onSort}>
                  Vendor No.
                </AdminTh>
                <AdminTh sortable sortKey="vendorName" sort={sort} onSort={onSort}>
                  Vendor Name
                </AdminTh>
                <AdminTh sortable sortKey="itemGroup" sort={sort} onSort={onSort}>
                  Item Group
                </AdminTh>
                <AdminTh sortable sortKey="material" sort={sort} onSort={onSort}>
                  Material
                </AdminTh>
                <AdminTh sortable sortKey="materialDescription" sort={sort} onSort={onSort}>
                  Material Description
                </AdminTh>
                <AdminTh sortable sortKey="barcode" sort={sort} onSort={onSort}>
                  Barcode of Spare Part
                </AdminTh>
                <AdminTh sortable sortKey="soConRtn" sort={sort} onSort={onSort}>
                  SO.No. (Con/Rtn)
                </AdminTh>
                <AdminTh sortable sortKey="soLoan" sort={sort} onSort={onSort}>
                  SO.No. (Loan)
                </AdminTh>
                <AdminTh sortable sortKey="loanDate" sort={sort} onSort={onSort}>
                  Loan Date
                </AdminTh>
                <AdminTh sortable sortKey="loanRtnDate" sort={sort} onSort={onSort}>
                  Loan Rtn Date
                </AdminTh>
                <AdminTh sortable sortKey="cnsmpDate" sort={sort} onSort={onSort}>
                  Cnsmp.Date
                </AdminTh>
                <AdminTh align="right" sortable sortKey="noCnsmpCount" sort={sort} onSort={onSort}>
                  No Cnsmp.Count
                </AdminTh>
                <AdminTh sortable sortKey="saleDate" sort={sort} onSort={onSort}>
                  Sale Date
                </AdminTh>
                <AdminTh sortable sortKey="saleRtnDate" sort={sort} onSort={onSort}>
                  Sale Rtn Date
                </AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-3 py-8 text-center text-[12px] text-slate-500">
                    {loading
                      ? 'Loading…'
                      : imports.length === 0
                        ? 'No imports yet — upload ZSS02 HTML to get started'
                        : 'No rows match the current filters'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const plantLabel = branchFileLabel(r.plant, r.plantName);
                  return (
                    <AdminTr key={r.id}>
                      <AdminTd className="w-10 text-center">
                        <IssueCell issue={r.issue} detail={r.issueDetail} />
                      </AdminTd>
                      <AdminTd className="max-w-[14rem]" title={plantLabel}>
                        <div className="truncate">{plantLabel}</div>
                      </AdminTd>
                      <AdminTd>{r.vendorNo}</AdminTd>
                      <AdminTd
                        className={`max-w-[12rem] truncate ${
                          r.issue === 'franchisee_change' ? 'font-medium text-rose-700' : ''
                        }`}
                        title={r.vendorName}
                      >
                        {r.vendorName}
                      </AdminTd>
                      <AdminTd className="max-w-[12rem] truncate" title={r.itemGroup ?? undefined}>
                        {r.itemGroup || '—'}
                      </AdminTd>
                      <AdminTd>{r.material}</AdminTd>
                      <AdminTd className="max-w-[16rem] truncate" title={r.materialDescription}>
                        {r.materialDescription}
                      </AdminTd>
                      <AdminTd>{r.barcode}</AdminTd>
                      <AdminTd>{r.soConRtn}</AdminTd>
                      <AdminTd>{r.soLoan}</AdminTd>
                      <AdminTd>{r.loanDate}</AdminTd>
                      <AdminTd>{r.loanRtnDate}</AdminTd>
                      <AdminTd>{r.cnsmpDate}</AdminTd>
                      <AdminTd align="right">{r.noCnsmpCount}</AdminTd>
                      <AdminTd>{r.saleDate}</AdminTd>
                      <AdminTd>{r.saleRtnDate}</AdminTd>
                    </AdminTr>
                  );
                })
              )}
            </tbody>
          </AdminTable>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 px-1 pb-1">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[12px] text-slate-600">
            Page {page} / {totalPages}
          </span>
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
    </PageShell>
  );
}
