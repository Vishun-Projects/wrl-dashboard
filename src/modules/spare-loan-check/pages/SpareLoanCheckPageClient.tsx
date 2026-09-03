'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { formatUiDateDash } from '@/lib/dates/ui-date';
import { useTableSort } from '@/lib/ui/table-sort';
import { feedback } from '@/lib/ui/feedback';
import type {
  SpareLoanCheckResponse,
  SpareLoanProblemReason,
  SpareLoanProblemRow,
} from '@/modules/spare-loan-check/types';

const API = '/api/report/spare-loan-check';

const REASON_LABEL: Record<SpareLoanProblemReason, string> = {
  vendor_mismatch: 'Vendor mismatch',
  cancelled: 'Cancelled',
};

type SortKey =
  | 'plant'
  | 'vendorNo'
  | 'material'
  | 'materialDescription'
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

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadProblemsCsv(rows: SpareLoanProblemRow[]) {
  const headers = [
    'Plant',
    'Vendor No',
    'Vendor Name',
    'Material',
    'Material Description',
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
        r.plant,
        r.vendorNo,
        r.vendorName,
        r.material,
        r.materialDescription,
        r.barcode,
        r.soLoan,
        r.soConRtn,
        r.matchKey,
        r.matchSource,
        r.crmVendorCode ?? '',
        r.crmVendorName ?? '',
        r.callLoggedAt ?? '',
        r.lastEditedAt ?? '',
        r.reason,
        r.cancelReason ?? '',
      ]
        .map((c) => csvEscape(String(c)))
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spare-loan-check-mismatches-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

export default function SpareLoanCheckPageClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpareLoanCheckResponse | null>(null);
  const [savedPlants, setSavedPlants] = useState<SavedPlantOption[]>([]);
  const [plantFilter, setPlantFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const { sort, onSort, sorted } = useTableSort<SortKey>(null);

  const allRows = result?.rows ?? [];
  const summary = result?.summary;

  const plantOptions = useMemo<FilterSelectOption[]>(
    () =>
      savedPlants.map((p) => ({
        value: p.plant,
        label: `${p.plant} (${p.problems})`,
      })),
    [savedPlants]
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

  const sourceOptions = useMemo<FilterSelectOption[]>(
    () => [
      { value: 'loan', label: 'Loan' },
      { value: 'con_rtn', label: 'Con/Rtn' },
    ],
    []
  );

  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      if (reasonFilter && r.reason !== reasonFilter) return false;
      if (vendorFilter && r.vendorNo !== vendorFilter) return false;
      if (sourceFilter && r.matchSource !== sourceFilter) return false;
      return true;
    });
  }, [allRows, reasonFilter, vendorFilter, sourceFilter]);

  function sortValue(row: SpareLoanProblemRow, key: SortKey): unknown {
    switch (key) {
      case 'plant':
        return row.plant;
      case 'vendorNo':
        return row.vendorNo;
      case 'material':
        return row.material;
      case 'materialDescription':
        return row.materialDescription;
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
    const counts = { vendor_mismatch: 0, cancelled: 0 };
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
      const form = new FormData();
      form.set('file', file);
      const res = await fetch(API, { method: 'POST', body: form, credentials: 'include' });
      const data = await readApiJson(res);
      if (!res.ok) {
        throw new Error(String(data.error || `Check failed (${res.status})`));
      }
      const payload = data as unknown as SpareLoanCheckResponse;
      setResult(payload);
      const plants = payload.savedPlants ?? [];
      const plantNote = plants.length ? ` · saved plant(s) ${plants.join(', ')}` : '';
      feedback.actionSuccess(`Found ${payload.summary.problems} problem row(s)${plantNote}`);
      await refreshPlants();
      if (plants[0]) setPlantFilter(plants[0]);
      setReasonFilter('');
      setVendorFilter('');
      setSourceFilter('');
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Spare Loan Check "
      subtitle={subtitle}
      toolbar={
        <div className="register-filter-bar border-b border-slate-200 px-4 py-2">
          <div className="flex flex-wrap items-end gap-3">
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
                void loadRows(next);
              }}
              searchPlaceholder="Search plant…"
              panelClassName="w-56"
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
              label="SO source"
              emptyLabel="Loan or Con/Rtn"
              options={sourceOptions}
              selected={sourceFilter ? [sourceFilter] : []}
              mode="single"
              onChange={(values) => setSourceFilter(pickSingle(values))}
              panelClassName="w-44"
              layout="inline"
            />
            {summary ? (
              <div className="ml-auto flex flex-wrap gap-2 pb-1 text-[11px]">
                {(Object.keys(REASON_LABEL) as SpareLoanProblemReason[]).map((key) => (
                  <span
                    key={key}
                    className="rounded-md border border-rose-100 bg-rose-50 px-2 py-1 text-rose-800"
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
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => downloadProblemsCsv(rows)}
            disabled={rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      }
    >
      <PageScrollRegion>
        <div className="p-3">
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
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh sortable sortKey="plant" sort={sort} onSort={(k) => onSort(k as SortKey)}>
                    Plant
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="vendorNo"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Vendor (Stock issued to)
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="material"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Material
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="materialDescription"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Material Description
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="matchKey"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    SO
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="matchSource"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Source
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="crmVendorCode"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    CRM Vendor
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="callLoggedAt"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey, 'desc')}
                  >
                    Call logged
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="lastEditedAt"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey, 'desc')}
                  >
                    Cancel / transfer edit
                  </AdminTh>
                  <AdminTh sortable sortKey="reason" sort={sort} onSort={(k) => onSort(k as SortKey)}>
                    Reason
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="cancelReason"
                    sort={sort}
                    onSort={(k) => onSort(k as SortKey)}
                  >
                    Cancel Reason
                  </AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {loading ? (
                  <AdminTr>
                    <td className="px-4 py-3 text-[12px] text-slate-500" colSpan={11}>
                      Loading…
                    </td>
                  </AdminTr>
                ) : (
                  rows.map((r, i) => {
                    const vendorMismatch = r.reason === 'vendor_mismatch';
                    const nameHighlight = vendorMismatch
                      ? 'text-[10px] font-medium text-rose-700'
                      : 'text-[10px] text-slate-500';
                    return (
                    <AdminTr key={`${r.matchKey}-${r.vendorNo}-${r.material}-${i}`}>
                      <AdminTd className="font-mono text-[11px]">{r.plant}</AdminTd>
                      <AdminTd>
                        <div className="font-mono text-[11px]">{r.vendorNo}</div>
                        <div className={nameHighlight}>{r.vendorName || '—'}</div>
                      </AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.material}</AdminTd>
                      <AdminTd className="max-w-[220px] text-[11px]">{r.materialDescription || '—'}</AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.matchKey}</AdminTd>
                      <AdminTd className="text-[11px]">
                        {r.matchSource === 'loan' ? 'Loan' : 'Con/Rtn'}
                      </AdminTd>
                      <AdminTd>
                        <div className="font-mono text-[11px]">{r.crmVendorCode ?? '—'}</div>
                        <div className={nameHighlight}>{r.crmVendorName || '—'}</div>
                      </AdminTd>
                      <AdminTd className="whitespace-nowrap text-[11px]">
                        {r.callLoggedAt ? formatUiDateDash(r.callLoggedAt) || '—' : '—'}
                      </AdminTd>
                      <AdminTd className="whitespace-nowrap text-[11px]">
                        {r.lastEditedAt ? formatUiDateDash(r.lastEditedAt) || '—' : '—'}
                      </AdminTd>
                      <AdminTd>
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800">
                          {REASON_LABEL[r.reason]}
                        </span>
                      </AdminTd>
                      <AdminTd className="max-w-[180px] truncate text-[11px]">
                        {r.cancelReason ?? '—'}
                      </AdminTd>
                    </AdminTr>
                    );
                  })
                )}
              </tbody>
            </AdminTable>
          </AdminTableCard>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
