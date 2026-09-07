'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { formatLocalDate } from '@/lib/dates/local-date';
import { formatUiDate, formatUiDateDash, UI_DATE_TIMEZONE } from '@/lib/dates/ui-date';
import { useTableSort } from '@/lib/ui/table-sort';
import { feedback } from '@/lib/ui/feedback';
import { escapeCsvCell } from '@/lib/utils/csv';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { gzipBlobForMisUpload } from '@/modules/mis/client-import/services/upload-gzip';
import { excelTextFormula } from '@/modules/spare-loan-check/excel-text';
import { branchFileLabel, plantExportValue, safeFilePart } from '@/modules/spare-loan-check/export-labels';
import { buildStoreZip } from '@/modules/spare-loan-check/zip-store';
import type {
  SpareLoanCheckResponse,
  SpareLoanProblemReason,
  SpareLoanProblemRow,
} from '@/modules/spare-loan-check/types';

const API = '/api/report/spare-loan-check';

const REASON_LABEL: Record<SpareLoanProblemReason, string> = {
  vendor_mismatch: 'Vendor mismatch',
  cancelled: 'Cancelled',
  unassigned_cancelled: 'Unassigned cancelled',
};

type SortKey =
  | 'plant'
  | 'zone'
  | 'vendorNo'
  | 'material'
  | 'materialDescription'
  | 'itemCategory'
  | 'barcode'
  | 'matchKey'
  | 'matchSource'
  | 'crmVendorCode'
  | 'callLoggedAt'
  | 'lastEditedAt'
  | 'reason'
  | 'cancelReason';

const REASON_OPTIONS: FilterSelectOption[] = [
  { value: 'vendor_mismatch', label: 'Vendor mismatch' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'unassigned_cancelled', label: 'Unassigned cancelled' },
];

type SavedPlantOption = {
  plant: string;
  fileName: string;
  problems: number;
  importedAt: string;
};

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

function buildProblemsCsv(rows: SpareLoanProblemRow[]): string {
  const headers = [
    'Plant',
    'Zone',
    'Vendor No',
    'Vendor Name',
    'Material',
    'Material Description',
    'Item Category',
    'Barcode',
    'SO Loan',
    'SO Con/Rtn',
    'SO',
    'Match Source',
    'CRM Vendor',
    'CRM Vendor Name',
    'Call Logged',
    'Last Edited',
    'Reason',
    'Cancel Reason',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        plantExportValue(r.plant, r.plantName),
        r.zone ?? '',
        r.vendorNo,
        r.vendorName,
        r.material,
        r.materialDescription,
        r.itemCategory ?? '',
        excelTextFormula(r.barcode),
        r.soLoan,
        r.soConRtn,
        r.matchKey,
        r.matchSource,
        r.crmVendorCode ?? '',
        r.crmVendorName ?? '',
        r.callLoggedAt ? formatUiDate(r.callLoggedAt) : '',
        r.lastEditedAt ? formatUiDate(r.lastEditedAt) : '',
        r.reason,
        r.cancelReason ?? '',
      ]
        .map((c) => escapeCsvCell(c))
        .join(',')
    ),
  ];
  return lines.join('\n');
}

function downloadCsvFile(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Group non-empty keys; empty key → Unassigned. */
function groupRowsBy(
  rows: SpareLoanProblemRow[],
  keyOf: (row: SpareLoanProblemRow) => string
): Array<{ key: string; rows: SpareLoanProblemRow[] }> {
  const map = new Map<string, SpareLoanProblemRow[]>();
  for (const row of rows) {
    const key = keyOf(row).trim() || 'Unassigned';
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupRows]) => ({ key, rows: groupRows }));
}

function uniqueFileNames(
  entries: Array<{ label: string; content: string }>
): Array<{ name: string; content: string }> {
  const used = new Map<string, number>();
  return entries.map(({ label, content }) => {
    const base = safeFilePart(label);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const stem = n === 1 ? base : `${base}_${n}`;
    return { name: `${stem}.csv`, content };
  });
}

function downloadGroupedZip(
  files: Array<{ name: string; content: string }>,
  zipName: string
) {
  downloadBlobFile(buildStoreZip(files), zipName);
}

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

type CallLoggedRange = { start: Date; end: Date; label: string };

const ALL_TIME_RANGE: CallLoggedRange = {
  start: new Date(0),
  end: new Date(),
  label: 'All Time',
};

/** Call log calendar day in UI timezone (YYYY-MM-DD), for from/to filters. */
function callLogCalendarDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: UI_DATE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export default function SpareLoanCheckPageClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDetailsElement>(null);
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<SpareLoanCheckResponse | null>(null);
  const [savedPlants, setSavedPlants] = useState<SavedPlantOption[]>([]);
  const [plantFilter, setPlantFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [loggedRange, setLoggedRange] = useState<CallLoggedRange>(ALL_TIME_RANGE);
  const [search, setSearch] = useState('');
  const { sort, onSort, sorted } = useTableSort<SortKey>(null);

  const allRows = result?.rows ?? [];
  const summary = result?.summary;

  const plantNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of allRows) {
      const name = r.plantName?.trim();
      if (r.plant && name && !map.has(r.plant)) map.set(r.plant, name);
    }
    return map;
  }, [allRows]);

  const plantOptions = useMemo<FilterSelectOption[]>(
    () =>
      savedPlants
        .filter((p) => p.problems > 0)
        .map((p) => {
          const name = plantNameByCode.get(p.plant);
          // CRM names are often already "1152 - BANGALORE BRANCH" — don't prefix the code again.
          const label = name
            ? name.toUpperCase().startsWith(p.plant.toUpperCase())
              ? `${name} (${p.problems})`
              : `${p.plant} — ${name} (${p.problems})`
            : `${p.plant} (${p.problems})`;
          return { value: p.plant, label };
        }),
    [savedPlants, plantNameByCode]
  );

  const vendorOptions = useMemo<FilterSelectOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of allRows) {
      if (!r.vendorNo) continue;
      if (!map.has(r.vendorNo)) {
        map.set(r.vendorNo, r.vendorName ? `${r.vendorNo} — ${r.vendorName}` : r.vendorNo);
      }
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label }));
  }, [allRows]);

  const zoneOptions = useMemo<FilterSelectOption[]>(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      const z = r.zone?.trim();
      if (z) set.add(z);
    }
    return [...set]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [allRows]);

  const categoryOptions = useMemo<FilterSelectOption[]>(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      const cat = r.itemCategory?.trim();
      if (cat) set.add(cat);
    }
    return [...set]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [allRows]);

  const sourceOptions = useMemo<FilterSelectOption[]>(
    () => [
      { value: 'loan', label: 'Loan' },
      { value: 'con_rtn', label: 'Con/Rtn' },
    ],
    []
  );

  const filteredRows = useMemo(() => {
    const applyLogged = loggedRange.label !== 'All Time';
    const from = applyLogged ? formatLocalDate(loggedRange.start) : '';
    const to = applyLogged ? formatLocalDate(loggedRange.end) : '';
    const q = search.trim().toUpperCase();
    return allRows.filter((r) => {
      if (reasonFilter && r.reason !== reasonFilter) return false;
      if (vendorFilter && r.vendorNo !== vendorFilter) return false;
      if (zoneFilter && (r.zone ?? '') !== zoneFilter) return false;
      if (categoryFilter && (r.itemCategory ?? '') !== categoryFilter) return false;
      if (sourceFilter && r.matchSource !== sourceFilter) return false;
      if (applyLogged) {
        const day = callLogCalendarDay(r.callLoggedAt);
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      if (q) {
        const hay = [r.matchKey, r.soLoan, r.soConRtn, r.barcode].join(' ').toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    allRows,
    reasonFilter,
    vendorFilter,
    zoneFilter,
    categoryFilter,
    sourceFilter,
    loggedRange,
    search,
  ]);
  function sortValue(row: SpareLoanProblemRow, key: SortKey): unknown {
    switch (key) {
      case 'plant':
        return row.plant;
      case 'zone':
        return row.zone;
      case 'vendorNo':
        return row.vendorNo;
      case 'material':
        return row.material;
      case 'materialDescription':
        return row.materialDescription;
      case 'itemCategory':
        return row.itemCategory;
      case 'barcode':
        return row.barcode;
      case 'matchKey':
        return row.matchKey;
      case 'matchSource':
        return row.matchSource;
      case 'crmVendorCode':
        return row.crmVendorCode;
      case 'callLoggedAt':
        return row.callLoggedAt;
      case 'lastEditedAt':
        return row.lastEditedAt;
      case 'reason':
        return row.reason;
      case 'cancelReason':
        return row.cancelReason;
      default:
        return null;
    }
  }

  const rows = useMemo(
    () => sorted(filteredRows, sortValue),
    [filteredRows, sorted]
  );

  const filteredByReason = useMemo(() => {
    const counts = {
      vendor_mismatch: 0,
      cancelled: 0,
      unassigned_cancelled: 0,
    };
    for (const r of filteredRows) counts[r.reason] += 1;
    return counts;
  }, [filteredRows]);

  const subtitle = useMemo(() => {
    if (!summary) {
      return 'Upload a plant HTML report. Only vendor mismatches and cancelled calls are shown.';
    }
    return `Parsed ${summary.parsed.toLocaleString()} · skipped ${summary.skipped.toLocaleString()} · ok ${summary.ok.toLocaleString()} · problems ${summary.problems.toLocaleString()} · showing ${rows.length.toLocaleString()}`;
  }, [summary, rows.length]);

  const refreshPlants = useCallback(async () => {
    try {
      const res = await fetch(`${API}?mode=plants`, { credentials: 'include' });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(String(data.error || 'Failed to load plants'));
      const plants = (data.plants as SavedPlantOption[]) ?? [];
      setSavedPlants(plants);
      return plants;
    } catch {
      setSavedPlants([]);
      return [] as SavedPlantOption[];
    }
  }, []);

  const loadRows = useCallback(async (plant: string) => {
    setLoading(true);
    try {
      const qs = plant
        ? `mode=rows&plant=${encodeURIComponent(plant)}`
        : 'mode=rows';
      const res = await fetch(`${API}?${qs}`, { credentials: 'include' });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(String(data.error || 'Failed to load rows'));
      setResult(data as unknown as SpareLoanCheckResponse);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load rows');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshPlants();
      await loadRows('');
    })();
  }, [refreshPlants, loadRows]);

  async function runCheck() {
    if (!file) {
      feedback.actionWarning('Choose a .htm / .html file first');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      // Vercel rejects ~4.5MB+ bodies (Function_Payload_Too_Large). Gzip HTML first.
      const { blob: wireBlob, encoding } = await gzipBlobForMisUpload(file);
      const form = new FormData();
      form.set('file', wireBlob, file.name);
      form.set('fileName', file.name);
      if (encoding) form.set('contentEncoding', encoding);
      const res = await fetch(API, { method: 'POST', body: form, credentials: 'include' });
      const data = await readApiJson(res);
      if (!res.ok) {
        const rawErr = String(data.error || `Check failed (${res.status})`);
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
      const checkResult = data as unknown as SpareLoanCheckResponse;
      setResult(checkResult);
      const plants = checkResult.savedPlants ?? [];
      const plantNote = plants.length ? ` · saved plant(s) ${plants.join(', ')}` : '';
      feedback.actionSuccess(`Found ${checkResult.summary.problems} problem row(s)${plantNote}`);
      await refreshPlants();
      if (plants[0]) setPlantFilter(plants[0]);
      setReasonFilter('');
      setVendorFilter('');
      setZoneFilter('');
      setCategoryFilter('');
      setSourceFilter('');
      setLoggedRange(ALL_TIME_RANGE);
      setSearch('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Check failed';
      if (/payload.?too.?large|entity too large|function_payload/i.test(msg)) {
        feedback.actionFailed(
          'File still too large after compression. Split the SAP report by plant and upload separately.'
        );
      } else {
        feedback.actionFailed(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function closeExportMenu() {
    if (exportMenuRef.current) exportMenuRef.current.open = false;
  }

  async function runExport(mode: 'consolidated' | 'branch' | 'zone') {
    if (filteredRows.length === 0 || exporting) return;
    closeExportMenu();
    setExporting(true);
    try {
      const date = exportDateStamp();
      if (mode === 'consolidated') {
        downloadCsvFile(
          buildProblemsCsv(filteredRows),
          `spare-loan-check-mismatches-${date}.csv`
        );
        return;
      }
      if (mode === 'branch') {
        const groups = plantFilter
          ? groupRowsBy(
              filteredRows.filter((r) => r.plant === plantFilter),
              (r) => r.plant
            )
          : groupRowsBy(filteredRows, (r) => r.plant);
        if (groups.length === 0) {
          feedback.actionFailed('No branch rows to export');
          return;
        }
        const labeled = groups.map((g) => {
          const name =
            g.rows.find((r) => r.plantName?.trim())?.plantName ??
            plantNameByCode.get(g.key) ??
            null;
          return {
            label: branchFileLabel(g.key, name),
            content: buildProblemsCsv(g.rows),
          };
        });
        if (labeled.length === 1) {
          downloadCsvFile(
            labeled[0]!.content,
            `spare-loan-${safeFilePart(labeled[0]!.label)}-${date}.csv`
          );
        } else {
          downloadGroupedZip(
            uniqueFileNames(labeled),
            `spare-loan-branches-${date}.zip`
          );
          feedback.actionSuccess(`Downloaded ZIP with ${labeled.length} branch CSV file(s)`);
        }
        return;
      }
      const groups = zoneFilter
        ? groupRowsBy(
            filteredRows.filter((r) => (r.zone ?? '') === zoneFilter),
            (r) => r.zone ?? 'Unassigned'
          )
        : groupRowsBy(filteredRows, (r) => r.zone ?? 'Unassigned');
      if (groups.length === 0) {
        feedback.actionFailed('No zone rows to export');
        return;
      }
      const labeled = groups.map((g) => ({
        label: g.key,
        content: buildProblemsCsv(g.rows),
      }));
      if (labeled.length === 1) {
        downloadCsvFile(
          labeled[0]!.content,
          `spare-loan-${safeFilePart(labeled[0]!.label)}-${date}.csv`
        );
      } else {
        downloadGroupedZip(uniqueFileNames(labeled), `spare-loan-zones-${date}.zip`);
        feedback.actionSuccess(`Downloaded ZIP with ${labeled.length} zone CSV file(s)`);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageShell
      title="Spare Loan Check "
      subtitle={subtitle}
      toolbar={
        <div className="register-filter-bar register-filter-row-compact !px-2 !py-1">
          <div className="flex flex-wrap items-center gap-1.5 [&_.filter-select-root]:!min-w-[7.5rem] [&_.filter-select-root]:!max-w-[11rem] [&_.filter-select-root]:!flex-[0_1_9rem] [&_.register-filter-btn]:!h-6 [&_.register-filter-btn]:!px-1.5 [&_.register-filter-btn]:!text-[10px] [&_.register-filter-btn]:!shadow-none">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SO / call no or barcode…"
              aria-label="Search"
              className="h-6 w-40 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] text-slate-800 placeholder:text-slate-400"
            />
            <FilterSelect
              label="Plant"
              emptyLabel="All plants"
              options={plantOptions}
              selected={plantFilter ? [plantFilter] : []}
              mode="single"
              onChange={(values) => {
                const next = pickSingle(values);
                setPlantFilter(next);
                setVendorFilter('');
                setZoneFilter('');
                setCategoryFilter('');
                setLoggedRange(ALL_TIME_RANGE);
                setSearch('');
                void loadRows(next);
              }}
              searchPlaceholder="Search plant…"
              panelClassName="w-72"
              layout="inline"
            />
            <FilterSelect
              label="Reason"
              emptyLabel="All reasons"
              options={REASON_OPTIONS}
              selected={reasonFilter ? [reasonFilter] : []}
              mode="single"
              onChange={(values) => setReasonFilter(pickSingle(values))}
              panelClassName="w-48"
              layout="inline"
            />
            <FilterSelect
              label="Vendor"
              emptyLabel="All vendors"
              options={vendorOptions}
              selected={vendorFilter ? [vendorFilter] : []}
              mode="single"
              onChange={(values) => setVendorFilter(pickSingle(values))}
              searchPlaceholder="Search vendor…"
              panelClassName="w-72"
              layout="inline"
            />
            <FilterSelect
              label="Zone"
              emptyLabel="All zones"
              options={zoneOptions}
              selected={zoneFilter ? [zoneFilter] : []}
              mode="single"
              onChange={(values) => setZoneFilter(pickSingle(values))}
              panelClassName="w-48"
              layout="inline"
            />
            <FilterSelect
              label="Item category"
              emptyLabel="All categories"
              options={categoryOptions}
              selected={categoryFilter ? [categoryFilter] : []}
              mode="single"
              onChange={(values) => setCategoryFilter(pickSingle(values))}
              searchPlaceholder="Search category…"
              panelClassName="w-56"
              layout="inline"
            />
            <FilterSelect
              label="SO source"
              emptyLabel="Loan or Con/Rtn"
              options={sourceOptions}
              selected={sourceFilter ? [sourceFilter] : []}
              mode="single"
              onChange={(values) => setSourceFilter(pickSingle(values))}
              panelClassName="w-44"
              layout="inline"
            />
            <div className="min-w-[7.5rem] max-w-[10rem] shrink-0 [&_button]:!h-6 [&_button]:!px-1.5 [&_button]:!text-[10px] [&_button]:!shadow-none">
              <DateRangeSelector
                value={loggedRange.label}
                startDate={loggedRange.start}
                endDate={loggedRange.end}
                includeAllTime
                onChange={(range) => setLoggedRange(range)}
              />
            </div>
            {summary ? (
              <div className="ml-auto flex flex-wrap items-center gap-1 text-[9px]">
                {(Object.keys(REASON_LABEL) as SpareLoanProblemReason[]).map((key) => (
                  <span
                    key={key}
                    className="rounded border border-rose-100 bg-rose-50 px-1 py-px text-rose-800"
                  >
                    {REASON_LABEL[key]}: {filteredByReason[key].toLocaleString()}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".htm,.html,text/html"
            className="hidden"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setFile(next);
              setFileName(next?.name ?? '');
            }}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
          >
            <Upload className="h-3.5 w-3.5" />
            {fileName || 'Choose HTML…'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={() => void runCheck()}
            disabled={loading || !file}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {loading ? 'Checking…' : 'Run check'}
          </button>
          <details
            ref={exportMenuRef}
            className="relative"
            onToggle={(e) => {
              if ((filteredRows.length === 0 || exporting) && e.currentTarget.open) {
                e.currentTarget.open = false;
              }
            }}
          >
            <summary
              className={`inline-flex list-none items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden ${
                filteredRows.length === 0 || exporting ? 'pointer-events-none opacity-50' : 'cursor-pointer'
              }`}
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {exporting ? 'Exporting…' : 'CSV'}
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-md">
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={filteredRows.length === 0 || exporting}
                onClick={() => void runExport('consolidated')}
              >
                Consolidated
                <span className="mt-0.5 block text-[10px] text-slate-500">Full export (current filters)</span>
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={filteredRows.length === 0 || exporting}
                onClick={() => void runExport('branch')}
              >
                Branch wise
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  {plantFilter
                    ? `Selected plant → named CSV`
                    : 'ZIP with one CSV per branch name'}
                </span>
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={filteredRows.length === 0 || exporting}
                onClick={() => void runExport('zone')}
              >
                Zone wise
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  {zoneFilter ? `Selected zone → named CSV` : 'ZIP with one CSV per zone'}
                </span>
              </button>
            </div>
          </details>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-3">
          <AdminTableCard
            isEmpty={!loading && rows.length === 0}
            empty={
              <p className="p-6 text-sm text-slate-500">
                {result
                  ? 'No rows match the current filters.'
                  : 'Upload a HTML file and run the check, or pick a saved plant.'}
              </p>
            }
          >
            <AdminTable className="w-full min-w-0 table-fixed border-collapse text-left [&_td]:!px-1.5 [&_td]:!py-1 [&_td]:text-[11px] [&_td]:leading-snug">
              <AdminThead>
                <tr>
                  <AdminTh
                    className="w-[11%]"
                    sortable
                    sortKey="plant"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Plant
                  </AdminTh>
                  <AdminTh
                    className="w-[7%]"
                    sortable
                    sortKey="zone"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Zone
                  </AdminTh>
                  <AdminTh
                    className="w-[10%]"
                    sortable
                    sortKey="vendorNo"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Vendor
                  </AdminTh>
                  <AdminTh
                    className="w-[7%]"
                    sortable
                    sortKey="material"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Material
                  </AdminTh>
                  <AdminTh
                    className="w-[12%]"
                    sortable
                    sortKey="materialDescription"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Description
                  </AdminTh>
                  <AdminTh
                    className="w-[7%]"
                    sortable
                    sortKey="itemCategory"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Category
                  </AdminTh>
                  <AdminTh
                    className="w-[9%]"
                    sortable
                    sortKey="barcode"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Barcode
                  </AdminTh>
                  <AdminTh
                    className="w-[7%]"
                    sortable
                    sortKey="matchKey"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    SO
                  </AdminTh>
                  <AdminTh
                    className="w-[5%]"
                    sortable
                    sortKey="matchSource"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Src
                  </AdminTh>
                  <AdminTh
                    className="w-[9%]"
                    sortable
                    sortKey="crmVendorCode"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    CRM Vendor
                  </AdminTh>
                  <AdminTh
                    className="w-[6%]"
                    sortable
                    sortKey="callLoggedAt"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey, 'desc')}
                  >
                    Logged
                  </AdminTh>
                  <AdminTh
                    className="w-[6%]"
                    sortable
                    sortKey="lastEditedAt"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey, 'desc')}
                  >
                    Edited
                  </AdminTh>
                  <AdminTh
                    className="w-[7%]"
                    sortable
                    sortKey="reason"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Reason
                  </AdminTh>
                  <AdminTh
                    className="w-[7%]"
                    sortable
                    sortKey="cancelReason"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Cancel
                  </AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {loading ? (
                  <AdminTr>
                    <td className="px-1 py-1 text-[11px] text-slate-500" colSpan={14}>
                      Loading…
                    </td>
                  </AdminTr>
                ) : (
                  rows.map((r, i) => {
                    const vendorMismatch = r.reason === 'vendor_mismatch';
                    const nameHighlight = vendorMismatch
                      ? 'break-words text-[10px] font-medium leading-snug text-rose-700'
                      : 'break-words text-[10px] leading-snug text-slate-500';
                    const plantLabel = r.plantName?.trim() || r.plant;
                    return (
                    <AdminTr key={`${r.matchKey}-${r.vendorNo}-${r.material}-${i}`}>
                      <AdminTd className="text-[11px] leading-snug">
                        <div className="break-words">{plantLabel}</div>
                      </AdminTd>
                      <AdminTd className="text-[11px] leading-snug">
                        <div className="break-words">{r.zone || '—'}</div>
                      </AdminTd>
                      <AdminTd className="leading-snug">
                        <div className="break-all font-mono text-[11px] leading-snug">{r.vendorNo}</div>
                        <div className={nameHighlight}>{r.vendorName || '—'}</div>
                      </AdminTd>
                      <AdminTd className="font-mono text-[11px] leading-snug">
                        <div className="break-all">{r.material}</div>
                      </AdminTd>
                      <AdminTd className="text-[11px] leading-snug">
                        <div className="break-words">{r.materialDescription || '—'}</div>
                      </AdminTd>
                      <AdminTd className="text-[11px] leading-snug">
                        <div className="break-words">{r.itemCategory || '—'}</div>
                      </AdminTd>
                      <AdminTd className="font-mono text-[10px] leading-snug">
                        <div className="break-all">{r.barcode || '—'}</div>
                      </AdminTd>
                      <AdminTd className="font-mono text-[11px] leading-snug">
                        <div className="break-all">{r.matchKey}</div>
                      </AdminTd>
                      <AdminTd className="text-[11px] leading-snug">
                        {r.matchSource === 'loan' ? 'Loan' : 'Con/Rtn'}
                      </AdminTd>
                      <AdminTd className="leading-snug">
                        <div className="break-all font-mono text-[11px] leading-snug">
                          {r.crmVendorCode ?? '—'}
                        </div>
                        <div className={nameHighlight}>{r.crmVendorName || '—'}</div>
                      </AdminTd>
                      <AdminTd className="whitespace-nowrap text-[11px] leading-snug">
                        {r.callLoggedAt ? formatUiDateDash(r.callLoggedAt) || '—' : '—'}
                      </AdminTd>
                      <AdminTd className="whitespace-nowrap text-[11px] leading-snug">
                        {r.lastEditedAt ? formatUiDateDash(r.lastEditedAt) || '—' : '—'}
                      </AdminTd>
                      <AdminTd className="leading-snug">
                        <span className="rounded bg-rose-100 px-1 py-px text-[10px] font-medium leading-snug text-rose-800">
                          {REASON_LABEL[r.reason]}
                        </span>
                      </AdminTd>
                      <AdminTd className="text-[11px] leading-snug">
                        <div className="break-words">{r.cancelReason ?? '—'}</div>
                      </AdminTd>
                    </AdminTr>
                    );
                  })
                )}
              </tbody>
            </AdminTable>
          </AdminTableCard>
      </div>
    </PageShell>
  );
}
