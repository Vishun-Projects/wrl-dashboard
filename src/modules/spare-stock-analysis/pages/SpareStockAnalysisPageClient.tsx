'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Package, Upload } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { AdminTable, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { formatUiDate, formatUiDateTime } from '@/lib/dates/ui-date';
import { useTableSort } from '@/lib/ui/table-sort';
import { feedback } from '@/lib/ui/feedback';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { toDateString, type ReportDateRange } from '@/modules/mis';
import {
  abortSpareStockUpload,
  postSpareStockImport,
  prepareSpareStockWireUpload,
  readSpareStockApiJson,
  SPARE_STOCK_API,
  type SpareStockWireUpload,
} from '@/modules/spare-stock-analysis/upload-client';
import type {
  DefectiveReturnResponse,
  SpareStockBreakdownRow,
  SpareStockDbDupesChoice,
  SpareStockDupPreviewRow,
  SpareStockImportPreview,
  SpareStockImportResponse,
  SpareStockInFileDupesChoice,
  SpareStockOptionsResponse,
  SpareStockMovementRow,
  SpareStockRowsResponse,
  SpareStockSummaryResponse,
} from '@/modules/spare-stock-analysis/types';

const API = SPARE_STOCK_API;

const ALL_TIME: ReportDateRange = {
  start: new Date(0),
  end: new Date(),
  label: 'All Time',
};

const TXN_LABEL: Record<string, string> = {
  opening: 'Opening',
  receipt: 'Received',
  issued: 'Issued',
  consumption: 'Consumption',
  other: 'Other',
};

function formatQty(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

function buildParams(opts: {
  startDate: string;
  endDate: string;
  plant: string;
  supplier: string;
  material: string;
  page?: number;
  pageSize?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('startDate', opts.startDate);
  params.set('endDate', opts.endDate);
  if (opts.plant) params.set('plants', opts.plant);
  if (opts.supplier) params.set('suppliers', opts.supplier);
  if (opts.material) params.set('materials', opts.material);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  return params;
}

export default function SpareStockAnalysisPageClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dateRange, setDateRange] = useState<ReportDateRange>(ALL_TIME);
  const startDate = useMemo(() => toDateString(dateRange.start), [dateRange.start]);
  const endDate = useMemo(() => toDateString(dateRange.end), [dateRange.end]);
  const [view, setView] = useState<'stock' | 'defective'>('stock');
  const [plant, setPlant] = useState('');
  const [supplier, setSupplier] = useState('');
  const [material, setMaterial] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [options, setOptions] = useState<SpareStockOptionsResponse>({
    plants: [],
    suppliers: [],
    materials: [],
  });
  const [summary, setSummary] = useState<SpareStockSummaryResponse | null>(null);
  const [rowsData, setRowsData] = useState<SpareStockRowsResponse | null>(null);
  const [defective, setDefective] = useState<DefectiveReturnResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('Importing…');
  const [fileName, setFileName] = useState('');
  const [pendingUpload, setPendingUpload] = useState<SpareStockWireUpload | null>(null);
  const [preview, setPreview] = useState<SpareStockImportPreview | null>(null);
  const [inFileDupes, setInFileDupes] = useState<SpareStockInFileDupesChoice>('skip');
  const [dbDupes, setDbDupes] = useState<SpareStockDbDupesChoice>('skip');

  const plantOpts = useMemo<FilterSelectOption[]>(
    () => options.plants.map((p) => ({ value: p, label: p })),
    [options.plants]
  );
  const supplierOpts = useMemo<FilterSelectOption[]>(
    () => options.suppliers.map((s) => ({ value: s, label: s })),
    [options.suppliers]
  );
  const materialOpts = useMemo<FilterSelectOption[]>(
    () => options.materials.map((m) => ({ value: m.value, label: m.label })),
    [options.materials]
  );

  const resetPage = useCallback(() => setPage(1), []);

  const refreshOptions = useCallback(async () => {
    try {
      const res = await fetch(`${API}?mode=options`, { credentials: 'include' });
      const data = await readSpareStockApiJson(res);
      if (!res.ok) throw new Error(String(data.error || 'Failed to load filters'));
      setOptions(data as unknown as SpareStockOptionsResponse);
    } catch {
      /* options are best-effort */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = { startDate, endDate, plant, supplier, material };
      if (view === 'defective') {
        const res = await fetch(`${API}?mode=defective&${buildParams(base).toString()}`, {
          credentials: 'include',
        });
        const json = await readSpareStockApiJson(res);
        if (!res.ok) throw new Error(String(json.error || 'Failed to load defective returns'));
        setDefective(json as unknown as DefectiveReturnResponse);
        return;
      }
      const [summaryRes, rowsRes] = await Promise.all([
        fetch(`${API}?mode=summary&${buildParams(base).toString()}`, { credentials: 'include' }),
        fetch(`${API}?mode=rows&${buildParams({ ...base, page, pageSize }).toString()}`, {
          credentials: 'include',
        }),
      ]);
      const summaryJson = await readSpareStockApiJson(summaryRes);
      const rowsJson = await readSpareStockApiJson(rowsRes);
      if (!summaryRes.ok) throw new Error(String(summaryJson.error || 'Failed to load summary'));
      if (!rowsRes.ok) throw new Error(String(rowsJson.error || 'Failed to load rows'));
      setSummary(summaryJson as unknown as SpareStockSummaryResponse);
      setRowsData(rowsJson as unknown as SpareStockRowsResponse);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load spare stock');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, plant, supplier, material, page, view]);

  useEffect(() => {
    void refreshOptions();
  }, [refreshOptions]);

  useEffect(() => {
    void load();
  }, [load]);

  async function finishImport(result: SpareStockImportResponse) {
    const bits = [`Imported ${result.inserted.toLocaleString()} row(s)`];
    if (result.inFileImported) bits.push(`${result.inFileImported} same-file extra(s)`);
    if (result.dbReplaced) bits.push(`${result.dbReplaced} replaced in DB`);
    if (result.dbSkipped) bits.push(`${result.dbSkipped} already in DB skipped`);
    if (result.duplicates && !result.dbSkipped) {
      bits.push(`${result.duplicates} duplicate(s) skipped`);
    }
    feedback.actionSuccess(bits.join(' · '));
    setPreview(null);
    setPendingUpload(null);
    await refreshOptions();
    resetPage();
    await load();
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setUploading(true);
    setUploadLabel('Compressing…');
    let upload: SpareStockWireUpload | null = null;
    try {
      upload = await prepareSpareStockWireUpload(file, setUploadLabel);
      const data = await postSpareStockImport(upload, 'preview', undefined, setUploadLabel);
      const next = data as unknown as SpareStockImportPreview;
      if (next.kind !== 'preview') throw new Error('Unexpected import response');
      if (next.inFile.extraCount === 0 && next.inDb.count === 0) {
        const committed = (await postSpareStockImport(upload, 'commit', {
          inFileDupes: 'skip',
          dbDupes: 'skip',
        }, setUploadLabel)) as unknown as SpareStockImportResponse;
        await finishImport(committed);
        return;
      }
      setPendingUpload(upload);
      setInFileDupes('skip');
      setDbDupes('skip');
      setPreview(next);
    } catch (err) {
      if (upload) void abortSpareStockUpload(upload);
      feedback.actionFailed(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function confirmImport() {
    if (!pendingUpload) return;
    setUploading(true);
    try {
      const committed = (await postSpareStockImport(pendingUpload, 'commit', {
        inFileDupes,
        dbDupes,
      }, setUploadLabel)) as unknown as SpareStockImportResponse;
      await finishImport(committed);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  const kpis = summary?.kpis;
  const last = summary?.lastImport;
  const rows = rowsData?.rows ?? [];
  const total = rowsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const kpiCards = [
    { label: 'Opening', value: kpis?.opening ?? 0 },
    { label: 'Received', value: kpis?.received ?? 0 },
    { label: 'Issued', value: kpis?.issued ?? 0 },
    { label: 'Consumption', value: kpis?.consumption ?? 0 },
    { label: 'Closing', value: kpis?.closing ?? 0 },
  ];

  return (
    <PageShell
      title="Spare Stock Analysis"
      subtitle={
        last
          ? `${last.fileName} · ${last.inserted.toLocaleString()} new / ${last.duplicates.toLocaleString()} dup · ${formatUiDateTime(last.importedAt)}`
          : 'Upload SAP MB51 .htm to build the spare stock ledger'
      }
      icon={<Package className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".htm,.html,text/html"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? uploadLabel : fileName || 'Import MB51.htm'}
          </button>
        </div>
      }
      toolbar={
        <div className="register-filter-bar border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
          <div className="report-toolbar-filters-row items-end">
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
              label="Branch"
              emptyLabel="All Branches"
              options={plantOpts}
              selected={plant ? [plant] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setPlant(pickSingle(values));
              }}
              searchPlaceholder="Search plant…"
              panelClassName="w-56"
              layout="inline"
            />
            <FilterSelect
              label="Franchisee"
              emptyLabel="All Franchisees"
              options={supplierOpts}
              selected={supplier ? [supplier] : []}
              mode="single"
              onChange={(values) => {
                resetPage();
                setSupplier(pickSingle(values));
              }}
              searchPlaceholder="Search supplier…"
              panelClassName="w-64"
              layout="inline"
            />
            {view === 'stock' ? (
              <FilterSelect
                label="Part"
                emptyLabel="All Parts"
                options={materialOpts}
                selected={material ? [material] : []}
                mode="single"
                onChange={(values) => {
                  resetPage();
                  setMaterial(pickSingle(values));
                }}
                searchPlaceholder="Search material…"
                panelClassName="w-80"
                layout="inline"
              />
            ) : null}
            <div className="flex items-center gap-1 self-end pb-0.5">
              <button
                type="button"
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                  view === 'stock'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-600'
                }`}
                onClick={() => setView('stock')}
              >
                Stock
              </button>
              <button
                type="button"
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                  view === 'defective'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-600'
                }`}
                onClick={() => setView('defective')}
              >
                Defective returns
              </button>
            </div>
            <span className="ml-auto shrink-0 self-end pb-1 text-[12px] text-slate-500">
              {loading
                ? 'Loading…'
                : view === 'defective'
                  ? `${(defective?.rows.length ?? 0).toLocaleString()} call(s)`
                  : `${total.toLocaleString()} movements in range`}
            </span>
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2">
          {preview ? (
            <div className="max-h-56 shrink-0 overflow-auto custom-scrollbar">
            <ImportDecisionPanel
              preview={preview}
              inFileDupes={inFileDupes}
              dbDupes={dbDupes}
              uploading={uploading}
              onInFile={setInFileDupes}
              onDb={setDbDupes}
              onCancel={() => {
                if (pendingUpload) void abortSpareStockUpload(pendingUpload);
                setPreview(null);
                setPendingUpload(null);
              }}
              onConfirm={() => void confirmImport()}
            />
            </div>
          ) : null}
          {view === 'defective' ? (
            <DefectiveReturnsView loading={loading} data={defective} />
          ) : (
            <StockView
              loading={loading}
              kpiCards={kpiCards}
              summary={summary}
              rows={rows}
              page={page}
              totalPages={totalPages}
              total={total}
              onPage={setPage}
            />
          )}
      </div>
    </PageShell>
  );
}

function DupTable({ rows, more }: { rows: SpareStockDupPreviewRow[]; more: number }) {
  return (
    <AdminTable className="w-full min-w-0 border-collapse text-left">
      <AdminThead>
        <tr>
          <AdminTh>Mat. Doc.</AdminTh>
          <AdminTh>Date</AdminTh>
          <AdminTh>Part</AdminTh>
          <AdminTh align="right">Qty</AdminTh>
          <AdminTh>MvT</AdminTh>
          <AdminTh>Copies</AdminTh>
          <AdminTh>Call</AdminTh>
        </tr>
      </AdminThead>
      <tbody>
        {rows.map((r, i) => (
          <AdminTr key={`${r.matDoc}-${r.material}-${i}`}>
            <AdminTd>{r.matDoc}</AdminTd>
            <AdminTd>{formatUiDate(r.postingDate)}</AdminTd>
            <AdminTd className="max-w-[14rem] truncate" title={r.materialDescription}>
              {r.material}
              {r.materialDescription ? ` — ${r.materialDescription}` : ''}
            </AdminTd>
            <AdminTd align="right">{formatQty(r.qty)}</AdminTd>
            <AdminTd>{r.mvt}</AdminTd>
            <AdminTd>{r.copies}</AdminTd>
            <AdminTd>{r.callNo}</AdminTd>
          </AdminTr>
        ))}
        {more > 0 ? (
          <tr>
            <td className="px-3 py-2 text-[12px] text-slate-500" colSpan={7}>
              + {more.toLocaleString()} more
            </td>
          </tr>
        ) : null}
      </tbody>
    </AdminTable>
  );
}

function ImportDecisionPanel({
  preview,
  inFileDupes,
  dbDupes,
  uploading,
  onInFile,
  onDb,
  onCancel,
  onConfirm,
}: {
  preview: SpareStockImportPreview;
  inFileDupes: SpareStockInFileDupesChoice;
  dbDupes: SpareStockDbDupesChoice;
  uploading: boolean;
  onInFile: (v: SpareStockInFileDupesChoice) => void;
  onDb: (v: SpareStockDbDupesChoice) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 shadow-2xs">
      <div className="text-[13px] font-semibold text-slate-800">This file needs a decision before import</div>
      <p className="mt-1 text-[12px] text-slate-600">
        {preview.parsed.toLocaleString()} rows parsed · {preview.newCount.toLocaleString()} new
        {preview.inFile.extraCount
          ? ` · ${preview.inFile.extraCount.toLocaleString()} extra copies inside this file`
          : ''}
        {preview.inDb.count
          ? ` · ${preview.inDb.count.toLocaleString()} already in the database`
          : ''}
      </p>

      {preview.inFile.extraCount > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-white p-2">
          <div className="text-[12px] font-semibold text-amber-900">Same-file duplicates</div>
          <p className="mt-0.5 text-[11px] text-slate-600">
            These lines repeat inside this HTM (same document, part, qty, time). Not a previous
            import.
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-700">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="infile"
                checked={inFileDupes === 'skip'}
                onChange={() => onInFile('skip')}
              />
              Keep one copy (skip extras)
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="infile"
                checked={inFileDupes === 'import'}
                onChange={() => onInFile('import')}
              />
              Import extra copies too
            </label>
          </div>
          <DupTable rows={preview.inFile.groups} more={0} />
        </div>
      ) : null}

      {preview.inDb.count > 0 ? (
        <div className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-2">
          <div className="text-[12px] font-semibold text-sky-950">Already in database</div>
          <p className="mt-0.5 text-[11px] text-slate-600">
            These are not repeats inside this file. They match a row stored from an earlier import.
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-700">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="indb"
                checked={dbDupes === 'skip'}
                onChange={() => onDb('skip')}
              />
              Skip (keep what is in DB)
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="indb"
                checked={dbDupes === 'replace'}
                onChange={() => onDb('replace')}
              />
              Replace existing
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="indb"
                checked={dbDupes === 'keep'}
                onChange={() => onDb('keep')}
              />
              Keep both (add again)
            </label>
          </div>
          <DupTable
            rows={preview.inDb.groups}
            more={Math.max(0, preview.inDb.count - preview.inDb.groups.length)}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          disabled={uploading}
          onClick={onConfirm}
        >
          {uploading ? 'Importing…' : 'Import with these choices'}
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700"
          disabled={uploading}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ScrollTableCard({
  title,
  extra,
  children,
  className = '',
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
        <div className="truncate text-[12px] font-semibold text-slate-700">{title}</div>
        {extra}
      </div>
      <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">{children}</div>
    </div>
  );
}

function KpiRow({ cards }: { cards: Array<{ label: string; value: number }> }) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-2xs">
          <div className="truncate text-[11px] font-medium text-slate-500">{card.label}</div>
          <div className="text-lg font-bold tracking-tight text-slate-900">{formatQty(card.value)}</div>
        </div>
      ))}
    </div>
  );
}

function DefectiveReturnsView({
  loading,
  data,
}: {
  loading: boolean;
  data: DefectiveReturnResponse | null;
}) {
  const [search, setSearch] = useState('');
  const frSort = useTableSort<'supplier' | 'consumed' | 'received' | 'outstanding'>({
    key: 'outstanding',
    dir: 'desc',
  });
  const callSort = useTableSort<
    'callNo' | 'plant' | 'supplier' | 'material' | 'consumed' | 'received' | 'outstanding'
  >({ key: 'outstanding', dir: 'desc' });

  const q = search.trim().toLowerCase();
  const callRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const filtered = q
      ? rows.filter(
          (r) =>
            r.callNo.toLowerCase().includes(q) ||
            r.supplier.toLowerCase().includes(q) ||
            r.plant.toLowerCase().includes(q) ||
            r.material.toLowerCase().includes(q) ||
            r.materialDescription.toLowerCase().includes(q)
        )
      : rows;
    return callSort.sorted(filtered, (row, key) =>
      key === 'material' ? `${row.material} ${row.materialDescription}` : row[key]
    );
  }, [data?.rows, q, callSort]);

  const frRows = useMemo(
    () => frSort.sorted(data?.byFranchisee ?? [], (row, key) => row[key]),
    [data?.byFranchisee, frSort]
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <KpiRow
        cards={[
          { label: 'Compressors consumed', value: data?.kpis.consumed ?? 0 },
          { label: 'Defective received (2303393)', value: data?.kpis.received ?? 0 },
          { label: 'Outstanding (not returned)', value: data?.kpis.outstanding ?? 0 },
        ]}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <ScrollTableCard
          title="Franchisee-wise"
          className="h-52 xl:h-auto"
        >
          <AdminTable className="w-full border-collapse text-left">
            <AdminThead>
              <tr>
                <AdminTh sortable sortKey="supplier" sort={frSort.sort} onSort={frSort.onSort}>
                  Franchisee
                </AdminTh>
                <AdminTh align="right" sortable sortKey="consumed" sort={frSort.sort} onSort={frSort.onSort}>
                  Cons
                </AdminTh>
                <AdminTh align="right" sortable sortKey="received" sort={frSort.sort} onSort={frSort.onSort}>
                  Recv
                </AdminTh>
                <AdminTh
                  align="right"
                  sortable
                  sortKey="outstanding"
                  sort={frSort.sort}
                  onSort={frSort.onSort}
                >
                  Out
                </AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-6 text-center text-[12px] text-slate-500" colSpan={4}>
                    Loading…
                  </td>
                </tr>
              ) : frRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-[12px] text-slate-500" colSpan={4}>
                    No franchisee rows.
                  </td>
                </tr>
              ) : (
                frRows.map((r) => (
                  <AdminTr key={r.supplier}>
                    <AdminTd className="whitespace-nowrap">{r.supplier}</AdminTd>
                    <AdminTd align="right">{formatQty(r.consumed)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.received)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.outstanding)}</AdminTd>
                  </AdminTr>
                ))
              )}
            </tbody>
          </AdminTable>
        </ScrollTableCard>

        <ScrollTableCard
          title="Call-wise vs 2303393"
          extra={
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search call, franchisee, part…"
              className="h-6 w-52 rounded border border-slate-200 px-2 text-[11px] text-slate-700"
            />
          }
        >
          <AdminTable className="w-full min-w-[720px] border-collapse text-left">
            <AdminThead>
              <tr>
                <AdminTh sortable sortKey="callNo" sort={callSort.sort} onSort={callSort.onSort}>
                  Call
                </AdminTh>
                <AdminTh sortable sortKey="plant" sort={callSort.sort} onSort={callSort.onSort}>
                  Branch
                </AdminTh>
                <AdminTh sortable sortKey="supplier" sort={callSort.sort} onSort={callSort.onSort}>
                  Franchisee
                </AdminTh>
                <AdminTh sortable sortKey="material" sort={callSort.sort} onSort={callSort.onSort}>
                  Consumed part
                </AdminTh>
                <AdminTh
                  align="right"
                  sortable
                  sortKey="consumed"
                  sort={callSort.sort}
                  onSort={callSort.onSort}
                >
                  Consumed
                </AdminTh>
                <AdminTh
                  align="right"
                  sortable
                  sortKey="received"
                  sort={callSort.sort}
                  onSort={callSort.onSort}
                >
                  Defective in
                </AdminTh>
                <AdminTh
                  align="right"
                  sortable
                  sortKey="outstanding"
                  sort={callSort.sort}
                  onSort={callSort.onSort}
                >
                  Outstanding
                </AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-8 text-center text-[12px] text-slate-500" colSpan={7}>
                    Loading…
                  </td>
                </tr>
              ) : callRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-[12px] text-slate-500" colSpan={7}>
                    No compressor consumption or defective receipts in this range.
                  </td>
                </tr>
              ) : (
                callRows.map((r, i) => (
                  <AdminTr key={`${r.plant}-${r.callNo}-${r.supplier}-${i}`}>
                    <AdminTd className="whitespace-nowrap">{r.callNo}</AdminTd>
                    <AdminTd>{r.plant}</AdminTd>
                    <AdminTd>{r.supplier}</AdminTd>
                    <AdminTd className="max-w-[18rem] truncate" title={r.materialDescription}>
                      {r.material
                        ? r.materialDescription
                          ? `${r.material} — ${r.materialDescription}`
                          : r.material
                        : '—'}
                    </AdminTd>
                    <AdminTd align="right">{formatQty(r.consumed)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.received)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.outstanding)}</AdminTd>
                  </AdminTr>
                ))
              )}
            </tbody>
          </AdminTable>
        </ScrollTableCard>
      </div>
    </div>
  );
}

function StockView({
  loading,
  kpiCards,
  summary,
  rows,
  page,
  totalPages,
  total,
  onPage,
}: {
  loading: boolean;
  kpiCards: Array<{ label: string; value: number }>;
  summary: SpareStockSummaryResponse | null;
  rows: SpareStockMovementRow[];
  page: number;
  totalPages: number;
  total: number;
  onPage: (n: number | ((p: number) => number)) => void;
}) {
  const moveSort = useTableSort<
    | 'postingDate'
    | 'plant'
    | 'matDoc'
    | 'material'
    | 'materialDescription'
    | 'qty'
    | 'mvt'
    | 'txnType'
    | 'supplier'
    | 'callNo'
  >({ key: 'postingDate', dir: 'desc' });
  const sortedRows = useMemo(
    () => moveSort.sorted(rows, (row, key) => row[key]),
    [rows, moveSort]
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <KpiRow cards={kpiCards} />
      <div className="grid h-44 shrink-0 grid-cols-1 gap-2 md:grid-cols-3">
        <BreakdownTable
          title="High consumption parts"
          empty="No consumption in this range."
          loading={loading}
          rows={(summary?.topConsumption ?? []).map((r) => ({
            key: r.material,
            label: r.materialDescription ? `${r.material} — ${r.materialDescription}` : r.material,
            opening: 0,
            received: 0,
            issued: 0,
            consumption: r.qty,
            closing: r.qty,
          }))}
          qtyOnly
        />
        <BreakdownTable
          title="Branch-wise"
          empty="No branch rows."
          loading={loading}
          rows={summary?.byBranch ?? []}
        />
        <BreakdownTable
          title="Franchisee-wise"
          empty="No franchisee rows."
          loading={loading}
          rows={summary?.byFranchisee ?? []}
        />
      </div>
      <ScrollTableCard
        className="min-h-0 flex-1"
        title={`Movements (${total.toLocaleString()})`}
        extra={
          totalPages > 1 ? (
            <div className="flex items-center gap-1 text-[11px] text-slate-600">
              <button
                type="button"
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => onPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => onPage((p) => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null
        }
      >
        <AdminTable className="w-full min-w-[880px] border-collapse text-left">
          <AdminThead>
            <tr>
              <AdminTh sortable sortKey="postingDate" sort={moveSort.sort} onSort={moveSort.onSort}>
                Posting Date
              </AdminTh>
              <AdminTh sortable sortKey="plant" sort={moveSort.sort} onSort={moveSort.onSort}>
                Branch
              </AdminTh>
              <AdminTh sortable sortKey="matDoc" sort={moveSort.sort} onSort={moveSort.onSort}>
                Mat. Doc.
              </AdminTh>
              <AdminTh sortable sortKey="material" sort={moveSort.sort} onSort={moveSort.onSort}>
                Part
              </AdminTh>
              <AdminTh
                sortable
                sortKey="materialDescription"
                sort={moveSort.sort}
                onSort={moveSort.onSort}
              >
                Description
              </AdminTh>
              <AdminTh align="right" sortable sortKey="qty" sort={moveSort.sort} onSort={moveSort.onSort}>
                Qty
              </AdminTh>
              <AdminTh sortable sortKey="mvt" sort={moveSort.sort} onSort={moveSort.onSort}>
                MvT
              </AdminTh>
              <AdminTh sortable sortKey="txnType" sort={moveSort.sort} onSort={moveSort.onSort}>
                Type
              </AdminTh>
              <AdminTh sortable sortKey="supplier" sort={moveSort.sort} onSort={moveSort.onSort}>
                Franchisee
              </AdminTh>
              <AdminTh sortable sortKey="callNo" sort={moveSort.sort} onSort={moveSort.onSort}>
                Call
              </AdminTh>
            </tr>
          </AdminThead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-8 text-center text-[12px] text-slate-500" colSpan={10}>
                  Loading…
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-[12px] text-slate-500" colSpan={10}>
                  No movements in this date range.
                </td>
              </tr>
            ) : (
              sortedRows.map((r, i) => (
                <AdminTr key={`${r.matDoc}-${r.material}-${r.mvt}-${i}`}>
                  <AdminTd className="whitespace-nowrap">{formatUiDate(r.postingDate)}</AdminTd>
                  <AdminTd>{r.plant}</AdminTd>
                  <AdminTd>{r.matDoc}</AdminTd>
                  <AdminTd>{r.material}</AdminTd>
                  <AdminTd className="max-w-[16rem] truncate">{r.materialDescription}</AdminTd>
                  <AdminTd align="right">{formatQty(r.qty)}</AdminTd>
                  <AdminTd>{r.mvt}</AdminTd>
                  <AdminTd>{TXN_LABEL[r.txnType] ?? r.txnType}</AdminTd>
                  <AdminTd>{r.supplier}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{r.callNo}</AdminTd>
                </AdminTr>
              ))
            )}
          </tbody>
        </AdminTable>
      </ScrollTableCard>
    </div>
  );
}

function BreakdownTable({
  title,
  empty,
  loading,
  rows,
  qtyOnly = false,
}: {
  title: string;
  empty: string;
  loading: boolean;
  rows: SpareStockBreakdownRow[];
  qtyOnly?: boolean;
}) {
  const sort = useTableSort<
    'label' | 'opening' | 'received' | 'issued' | 'consumption' | 'closing'
  >({
    key: qtyOnly ? 'consumption' : 'closing',
    dir: 'desc',
  });
  const sorted = useMemo(() => sort.sorted(rows, (row, key) => row[key]), [rows, sort]);

  return (
    <ScrollTableCard title={title}>
      <AdminTable className="w-full border-collapse text-left">
        <AdminThead>
          <tr>
            <AdminTh sortable sortKey="label" sort={sort.sort} onSort={sort.onSort}>
              {qtyOnly ? 'Part' : 'Name'}
            </AdminTh>
            {qtyOnly ? (
              <AdminTh
                align="right"
                sortable
                sortKey="consumption"
                sort={sort.sort}
                onSort={sort.onSort}
              >
                Qty
              </AdminTh>
            ) : (
              <>
                <AdminTh align="right" sortable sortKey="opening" sort={sort.sort} onSort={sort.onSort}>
                  Open
                </AdminTh>
                <AdminTh align="right" sortable sortKey="received" sort={sort.sort} onSort={sort.onSort}>
                  In
                </AdminTh>
                <AdminTh align="right" sortable sortKey="issued" sort={sort.sort} onSort={sort.onSort}>
                  Out
                </AdminTh>
                <AdminTh
                  align="right"
                  sortable
                  sortKey="consumption"
                  sort={sort.sort}
                  onSort={sort.onSort}
                >
                  Cons
                </AdminTh>
                <AdminTh align="right" sortable sortKey="closing" sort={sort.sort} onSort={sort.onSort}>
                  Close
                </AdminTh>
              </>
            )}
          </tr>
        </AdminThead>
        <tbody>
          {loading ? (
            <tr>
              <td className="px-3 py-4 text-center text-[12px] text-slate-500" colSpan={qtyOnly ? 2 : 6}>
                Loading…
              </td>
            </tr>
          ) : sorted.length === 0 ? (
            <tr>
              <td className="px-3 py-4 text-center text-[12px] text-slate-500" colSpan={qtyOnly ? 2 : 6}>
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((r) => (
              <AdminTr key={r.key}>
                <AdminTd className="max-w-[12rem] truncate" title={r.label}>
                  {r.label}
                </AdminTd>
                {qtyOnly ? (
                  <AdminTd align="right">{formatQty(r.consumption)}</AdminTd>
                ) : (
                  <>
                    <AdminTd align="right">{formatQty(r.opening)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.received)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.issued)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.consumption)}</AdminTd>
                    <AdminTd align="right">{formatQty(r.closing)}</AdminTd>
                  </>
                )}
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </ScrollTableCard>
  );
}
