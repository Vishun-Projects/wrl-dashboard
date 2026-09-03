'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
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

export default function SpareLoanCheckPageClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpareLoanCheckResponse | null>(null);
  const [savedPlants, setSavedPlants] = useState<SavedPlantOption[]>([]);
  const [plantFilter, setPlantFilter] = useState('');

  const rows = result?.rows ?? [];
  const summary = result?.summary;

  const plantOptions = useMemo<FilterSelectOption[]>(
    () =>
      savedPlants.map((p) => ({
        value: p.plant,
        label: `${p.plant} (${p.problems} problems)`,
      })),
    [savedPlants]
  );

  const subtitle = useMemo(() => {
    if (!summary) {
      return 'Upload a plant HTML report. Only vendor mismatches and cancelled calls are shown.';
    }
    return `Parsed ${summary.parsed.toLocaleString()} · skipped ${summary.skipped.toLocaleString()} · ok ${summary.ok.toLocaleString()} · problems ${summary.problems.toLocaleString()}`;
  }, [summary]);

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

  useEffect(() => {
    void refreshPlants();
  }, [refreshPlants]);

  async function loadPlant(plant: string) {
    if (!plant) {
      setResult(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}?mode=rows&plant=${encodeURIComponent(plant)}`, {
        credentials: 'include',
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(String(data.error || 'Failed to load plant'));
      setResult(data as unknown as SpareLoanCheckResponse);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load plant');
    } finally {
      setLoading(false);
    }
  }

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
      const refreshed = await refreshPlants();
      if (plants[0] && refreshed.some((p) => p.plant === plants[0])) {
        setPlantFilter(plants[0]);
      }
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
              setResult(null);
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
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Saved plant"
              emptyLabel="All / latest upload"
              options={plantOptions}
              selected={plantFilter ? [plantFilter] : []}
              mode="single"
              onChange={(values) => {
                const next = values[values.length - 1] ?? '';
                setPlantFilter(next);
                void loadPlant(next);
              }}
              searchPlaceholder="Search plant…"
              panelClassName="w-56"
              layout="inline"
            />
            {summary ? (
              <div className="flex flex-wrap gap-2 text-[11px] pb-1">
                {(Object.keys(REASON_LABEL) as SpareLoanProblemReason[]).map((key) => (
                  <span
                    key={key}
                    className="rounded-md border border-rose-100 bg-rose-50 px-2 py-1 text-rose-800"
                  >
                    {REASON_LABEL[key]}: {summary.byReason[key].toLocaleString()}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <AdminTableCard
            isEmpty={!loading && rows.length === 0}
            empty={
              <p className="p-6 text-sm text-slate-500">
                {result
                  ? 'No problem rows — all keyed SOs matched vendor and are active.'
                  : plantFilter
                    ? 'No saved rows for this plant.'
                    : 'Upload a HTML file and run the check, or pick a saved plant.'}
              </p>
            }
          >
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>Plant</AdminTh>
                  <AdminTh>Vendor (Stock issued to)</AdminTh>
                  <AdminTh>Material</AdminTh>
                  <AdminTh>Material Description</AdminTh>
                  <AdminTh>SO</AdminTh>
                  <AdminTh>Source</AdminTh>
                  <AdminTh>CRM Vendor</AdminTh>
                  <AdminTh>Reason</AdminTh>
                  <AdminTh>Cancel Reason</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {loading ? (
                  <AdminTr>
                    <td className="px-4 py-3 text-[12px] text-slate-500" colSpan={9}>
                      Loading…
                    </td>
                  </AdminTr>
                ) : (
                  rows.map((r, i) => (
                    <AdminTr key={`${r.matchKey}-${r.vendorNo}-${r.material}-${i}`}>
                      <AdminTd className="font-mono text-[11px]">{r.plant}</AdminTd>
                      <AdminTd>
                        <div className="font-mono text-[11px]">{r.vendorNo}</div>
                        <div className="text-[10px] text-slate-500">{r.vendorName}</div>
                      </AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.material}</AdminTd>
                      <AdminTd className="max-w-[220px] text-[11px]">{r.materialDescription || '—'}</AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.matchKey}</AdminTd>
                      <AdminTd className="text-[11px]">
                        {r.matchSource === 'loan' ? 'Loan' : 'Con/Rtn'}
                      </AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.crmVendorCode ?? '—'}</AdminTd>
                      <AdminTd>
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800">
                          {REASON_LABEL[r.reason]}
                        </span>
                      </AdminTd>
                      <AdminTd className="max-w-[180px] truncate text-[11px]">
                        {r.cancelReason ?? '—'}
                      </AdminTd>
                    </AdminTr>
                  ))
                )}
              </tbody>
            </AdminTable>
          </AdminTableCard>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
