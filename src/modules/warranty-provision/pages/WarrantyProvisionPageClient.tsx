'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ChevronLeft, ChevronRight, Download, Shield, Upload, X } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { AdminTable, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { feedback } from '@/lib/ui/feedback';
import { formatUiDate } from '@/lib/dates/ui-date';
import {
  asOfFromPeriodYm,
  fyStartYear,
  prevPeriodYmIst,
} from '@/modules/warranty-provision/fy';
import {
  cacheClearWarranty,
  cacheGet,
  cacheSet,
  snapCacheKey,
  unitsCacheKey,
  type SnapBundle,
} from '@/modules/warranty-provision/client-cache';
import type {
  ActiveUnitsResponse,
  BreakdownMfgDetailResponse,
  BreakdownMfgResponse,
  SnapResponse,
  WarrantyAssumptions,
  WarrantyClaimRow,
  WarrantyForecastResponse,
  WarrantyProvisionOptions,
  WarrantyProvisionRow,
  WarrantyProvisionRowsResponse,
  WarrantyRatesResponse,
} from '@/modules/warranty-provision/types';

const API = '/api/report/warranty-provision';
const PAGE_SIZES = [100, 250, 500, 1000] as const;
type Tab = 'snap' | 'units' | 'rates' | 'forecast' | 'claims' | 'assumptions';
type CellSel = { colLo: number; colHi: number; rowLo: number; rowHi: number };

const CELL_SEL_CLS = '!bg-sky-200';

const MONTH_OPTS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
] as const;

const SELECT_CLS =
  'h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800';

function yearOptsAround(periodYm: string): number[] {
  const cur = Number(periodYm.slice(0, 4)) || Number(prevPeriodYmIst().slice(0, 4));
  const from = cur - 10;
  const to = cur + 1;
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

function toOpts(values: string[]): FilterSelectOption[] {
  return values.map((v) => ({ value: v, label: v }));
}

function inr(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.5) return '-';
  return Math.round(n).toLocaleString('en-IN');
}

function inrMoney(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** Forecast KPIs: show 0 instead of hiding Base as '-'. */
function inrExact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

function inrMoneyExact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export default function WarrantyProvisionPageClient() {
  const [tab, setTab] = useState<Tab>('snap');
  const [periodYm, setPeriodYm] = useState(prevPeriodYmIst);
  const asOf = useMemo(() => asOfFromPeriodYm(periodYm), [periodYm]);
  const [strict, setStrict] = useState(false);
  const [fyFrom, setFyFrom] = useState(() => fyStartYear(asOfFromPeriodYm(prevPeriodYmIst())));
  const [fyCount, setFyCount] = useState(6);

  const [materialGroup, setMaterialGroup] = useState('');
  const [customerSubgroup, setCustomerSubgroup] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [material, setMaterial] = useState('');
  const [warrantyEndFy, setWarrantyEndFy] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(100);

  const [options, setOptions] = useState<WarrantyProvisionOptions>({
    materialGroups: [],
    customerSubgroups: [],
    states: [],
    cities: [],
    materials: [],
    warrantyEndFys: [],
  });
  const [rowsData, setRowsData] = useState<WarrantyProvisionRowsResponse | null>(null);
  const [snap, setSnap] = useState<SnapResponse | null>(null);
  const [activeUnits, setActiveUnits] = useState<ActiveUnitsResponse | null>(null);
  const [breakdownMfg, setBreakdownMfg] = useState<BreakdownMfgResponse | null>(null);
  const [breakdownWco, setBreakdownWco] = useState<BreakdownMfgResponse | null>(null);
  const [bdDetailYear, setBdDetailYear] = useState<string | null>(null);
  const [bdDetailBasis, setBdDetailBasis] = useState<'wp-active' | 'crm-w'>('wp-active');
  const [bdDetail, setBdDetail] = useState<BreakdownMfgDetailResponse | null>(null);
  const [bdDetailLoading, setBdDetailLoading] = useState(false);
  const [rates, setRates] = useState<WarrantyRatesResponse | null>(null);
  const [forecast, setForecast] = useState<WarrantyForecastResponse | null>(null);
  const [scenario, setScenario] = useState<'base' | 'optimistic' | 'pessimistic'>('base');
  const [claims, setClaims] = useState<{ rows: WarrantyClaimRow[]; total: number } | null>(null);
  const [assumptions, setAssumptions] = useState<WarrantyAssumptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimPreview, setClaimPreview] = useState<string>('');
  const [unitsImportStatus, setUnitsImportStatus] = useState<string>('');

  /** Rectangular cell select (browser table select always grabs whole rows). */
  const colDragRef = useRef<{
    col: number;
    row: number;
    armed: boolean;
    x: number;
    y: number;
    root: HTMLElement;
  } | null>(null);
  const [colSel, setColSel] = useState<CellSel | null>(null);
  const [selGridId, setSelGridId] = useState<string | null>(null);
  const colSelRef = useRef<CellSel | null>(null);
  const copyRootRef = useRef<HTMLElement | null>(null);
  colSelRef.current = colSel;

  const resetPage = useCallback(() => setPage(1), []);

  const snapQs = useMemo(() => {
    const p = new URLSearchParams({
      asOf,
      strict: strict ? '1' : '0',
      fyFrom: String(fyFrom),
      fyCount: String(fyCount),
    });
    return p;
  }, [asOf, strict, fyFrom, fyCount]);

  useEffect(() => {
    void (async () => {
      const cached = cacheGet<WarrantyProvisionOptions>('options');
      if (cached) setOptions(cached);
      try {
        const res = await fetch(`${API}?mode=options`, { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as WarrantyProvisionOptions;
        cacheSet('options', data);
        setOptions(data);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const loadSnap = useCallback(async () => {
    const key = snapCacheKey(snapQs.toString(), asOf, periodYm);
    const cached = cacheGet<SnapBundle>(key);
    if (cached) {
      setSnap(cached.snap);
      setActiveUnits(cached.active);
      setBreakdownMfg(cached.breakdown);
      setBreakdownWco(cached.breakdownWco);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const [snapRes, activeRes, bdRes, wcoRes] = await Promise.all([
        fetch(`${API}?mode=snap&${snapQs}`, { credentials: 'include' }),
        fetch(`${API}?mode=active-units&asOf=${encodeURIComponent(asOf)}`, {
          credentials: 'include',
        }),
        fetch(`${API}?mode=breakdown-mfg&periodYm=${encodeURIComponent(periodYm)}`, {
          credentials: 'include',
        }),
        fetch(`${API}?mode=breakdown-mfg-wco&periodYm=${encodeURIComponent(periodYm)}`, {
          credentials: 'include',
        }),
      ]);
      if (!snapRes.ok) throw new Error('SNAP load failed');
      const snapData = (await snapRes.json()) as SnapResponse;
      const activeData = activeRes.ok
        ? ((await activeRes.json()) as ActiveUnitsResponse)
        : null;
      let bdData: BreakdownMfgResponse | null = null;
      if (bdRes.ok) {
        bdData = (await bdRes.json()) as BreakdownMfgResponse;
      } else {
        const errBody = (await bdRes.json().catch(() => null)) as { error?: string } | null;
        feedback.actionFailed(errBody?.error || `Breakdown report failed (${bdRes.status})`);
      }
      let wcoData: BreakdownMfgResponse | null = null;
      if (wcoRes.ok) {
        wcoData = (await wcoRes.json()) as BreakdownMfgResponse;
      } else {
        const errBody = (await wcoRes.json().catch(() => null)) as { error?: string } | null;
        feedback.actionFailed(errBody?.error || `CRM WCO report failed (${wcoRes.status})`);
      }
      setSnap(snapData);
      setActiveUnits(activeData);
      setBreakdownMfg(bdData);
      setBreakdownWco(wcoData);
      if (bdData && wcoData) {
        cacheSet(key, {
          snap: snapData,
          active: activeData,
          breakdown: bdData,
          breakdownWco: wcoData,
        });
      }
    } catch (e) {
      if (!cached) feedback.actionFailed(e instanceof Error ? e.message : 'SNAP failed');
    } finally {
      setLoading(false);
    }
  }, [snapQs, asOf, periodYm]);

  const openBreakdownDetail = useCallback(
    async (year: number, basis: 'wp-active' | 'crm-w') => {
      const yearKey = String(year);
      setBdDetailYear(yearKey);
      setBdDetailBasis(basis);
      setBdDetail(null);
      setBdDetailLoading(true);
      try {
        const mode =
          basis === 'crm-w' ? 'breakdown-mfg-wco-detail' : 'breakdown-mfg-detail';
        const res = await fetch(
          `${API}?mode=${mode}&periodYm=${encodeURIComponent(periodYm)}&year=${encodeURIComponent(yearKey)}`,
          { credentials: 'include' }
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errBody?.error || `Detail failed (${res.status})`);
        }
        setBdDetail((await res.json()) as BreakdownMfgDetailResponse);
      } catch (e) {
        setBdDetailYear(null);
        feedback.actionFailed(e instanceof Error ? e.message : 'Detail failed');
      } finally {
        setBdDetailLoading(false);
      }
    },
    [periodYm]
  );

  const loadUnits = useCallback(async () => {
    const params = new URLSearchParams({
      mode: 'rows',
      asOf,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (materialGroup) params.set('materialGroups', materialGroup);
    if (customerSubgroup) params.set('customerSubgroups', customerSubgroup);
    if (state) params.set('states', state);
    if (city) params.set('cities', city);
    if (material) params.set('materials', material);
    if (warrantyEndFy) params.set('warrantyEndFys', warrantyEndFy);
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    const key = unitsCacheKey(params.toString());
    const cached = cacheGet<WarrantyProvisionRowsResponse>(key);
    if (cached) {
      setRowsData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch(`${API}?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Units load failed');
      const data = (await res.json()) as WarrantyProvisionRowsResponse;
      setRowsData(data);
      cacheSet(key, data);
    } catch (e) {
      if (!cached) feedback.actionFailed(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [
    asOf,
    page,
    pageSize,
    materialGroup,
    customerSubgroup,
    state,
    city,
    material,
    warrantyEndFy,
    status,
    q,
  ]);

  const loadRates = useCallback(async () => {
    const key = `rates:${snapQs}`;
    const cached = cacheGet<WarrantyRatesResponse>(key);
    if (cached) {
      setRates(cached);
      setLoading(false);
    } else setLoading(true);
    try {
      const res = await fetch(`${API}?mode=rates&${snapQs}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Rates load failed');
      const data = (await res.json()) as WarrantyRatesResponse;
      setRates(data);
      cacheSet(key, data);
    } catch (e) {
      if (!cached) feedback.actionFailed(e instanceof Error ? e.message : 'Rates failed');
    } finally {
      setLoading(false);
    }
  }, [snapQs]);

  const loadForecast = useCallback(async () => {
    const p = new URLSearchParams(snapQs);
    p.set('mode', 'forecast');
    p.set('scenario', scenario);
    const key = `forecast:${p}`;
    const cached = cacheGet<WarrantyForecastResponse>(key);
    if (cached) {
      setForecast(cached);
      setLoading(false);
    } else setLoading(true);
    try {
      const res = await fetch(`${API}?${p}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Forecast load failed');
      const data = (await res.json()) as WarrantyForecastResponse;
      setForecast(data);
      cacheSet(key, data);
    } catch (e) {
      if (!cached) feedback.actionFailed(e instanceof Error ? e.message : 'Forecast failed');
    } finally {
      setLoading(false);
    }
  }, [snapQs, scenario]);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}?mode=claims&page=1&pageSize=50&q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Claims load failed');
      setClaims((await res.json()) as { rows: WarrantyClaimRow[]; total: number });
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Claims failed');
    } finally {
      setLoading(false);
    }
  }, [q]);

  const loadAssumptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}?mode=assumptions`, { credentials: 'include' });
      if (!res.ok) throw new Error('Assumptions load failed');
      setAssumptions((await res.json()) as WarrantyAssumptions);
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Assumptions failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'snap') void loadSnap();
    else if (tab === 'units') void loadUnits();
    else if (tab === 'rates') void loadRates();
    else if (tab === 'forecast') void loadForecast();
    else if (tab === 'claims') void loadClaims();
    else if (tab === 'assumptions') void loadAssumptions();
  }, [tab, loadSnap, loadUnits, loadRates, loadForecast, loadClaims, loadAssumptions]);

  useEffect(() => {
    const endDrag = () => {
      const drag = colDragRef.current;
      if (!drag) return;
      const table = drag.root.querySelector('table') as HTMLElement | null;
      if (table) table.style.userSelect = '';
      colDragRef.current = null;
    };
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, []);

  // Drag clears the native selection, so Ctrl+C won't hit a focused table onCopy —
  // listen on document and write TSV (+ HTML table) from the highlighted range.
  useEffect(() => {
    if (!colSel) return;
    const onCopy = (e: ClipboardEvent) => {
      const sel = colSelRef.current;
      const root = copyRootRef.current;
      if (!sel || !root) return;
      const lines: string[] = [];
      const rowsHtml: string[] = [];
      for (let r = sel.rowLo; r <= sel.rowHi; r++) {
        const tr = root.querySelector(`tbody tr[data-row-index="${r}"]`);
        if (!tr) continue;
        const cells: string[] = [];
        const tds: string[] = [];
        for (let c = sel.colLo; c <= sel.colHi; c++) {
          const td = tr.children[c] as HTMLElement | undefined;
          const text = (td?.innerText ?? td?.textContent ?? '').replace(/\s+/g, ' ').trim();
          cells.push(text);
          tds.push(`<td>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`);
        }
        lines.push(cells.join('\t'));
        rowsHtml.push(`<tr>${tds.join('')}</tr>`);
      }
      const plain = lines.join('\n');
      if (!plain) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', plain);
      e.clipboardData?.setData('text/html', `<table>${rowsHtml.join('')}</table>`);
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [colSel]);

  function gridSelectHandlers(gridId: string) {
    return {
      onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const td = (e.target as HTMLElement).closest('tbody td');
        if (!td || (td as HTMLTableCellElement).colSpan > 1) {
          setColSel(null);
          setSelGridId(null);
          colDragRef.current = null;
          copyRootRef.current = null;
          return;
        }
        const tr = td.parentElement;
        const rowIdx = Number(tr?.getAttribute('data-row-index'));
        if (!Number.isFinite(rowIdx)) return;
        setColSel(null);
        setSelGridId(gridId);
        copyRootRef.current = e.currentTarget;
        colDragRef.current = {
          col: (td as HTMLTableCellElement).cellIndex,
          row: rowIdx,
          armed: false,
          x: e.clientX,
          y: e.clientY,
          root: e.currentTarget,
        };
      },
      onMouseMove: (e: ReactMouseEvent<HTMLDivElement>) => {
        const drag = colDragRef.current;
        if (!drag || drag.root !== e.currentTarget || (e.buttons & 1) === 0) return;
        if (!drag.armed) {
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
          drag.armed = true;
          const table = e.currentTarget.querySelector('table');
          if (table) table.style.userSelect = 'none';
          window.getSelection()?.removeAllRanges();
          setColSel({
            colLo: drag.col,
            colHi: drag.col,
            rowLo: drag.row,
            rowHi: drag.row,
          });
        }
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const td = under?.closest?.('tbody td') as HTMLTableCellElement | null;
        if (!td || td.colSpan > 1) return;
        if (!e.currentTarget.contains(td)) return;
        const rowIdx = Number(td.parentElement?.getAttribute('data-row-index'));
        if (!Number.isFinite(rowIdx)) return;
        const next: CellSel = {
          colLo: Math.min(drag.col, td.cellIndex),
          colHi: Math.max(drag.col, td.cellIndex),
          rowLo: Math.min(drag.row, rowIdx),
          rowHi: Math.max(drag.row, rowIdx),
        };
        setColSel((prev) =>
          prev &&
          prev.colLo === next.colLo &&
          prev.colHi === next.colHi &&
          prev.rowLo === next.rowLo &&
          prev.rowHi === next.rowHi
            ? prev
            : next
        );
      },
    };
  }

  function cellSelected(gridId: string, rowIndex: number, colIndex: number): boolean {
    return (
      selGridId === gridId &&
      colSel != null &&
      rowIndex >= colSel.rowLo &&
      rowIndex <= colSel.rowHi &&
      colIndex >= colSel.colLo &&
      colIndex <= colSel.colHi
    );
  }

  const rows: WarrantyProvisionRow[] = rowsData?.rows ?? [];
  const total = rowsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'snap', label: 'SNAP Report' },
    { id: 'units', label: 'Units' },
    { id: 'rates', label: 'Claim rates' },
    { id: 'forecast', label: 'Cost forecast' },
    { id: 'claims', label: 'Claims' },
    { id: 'assumptions', label: 'Assumptions' },
  ];

  async function downloadSnap() {
    const res = await fetch(`${API}?mode=snap-export&${snapQs}`, { credentials: 'include' });
    if (!res.ok) {
      feedback.actionFailed('Export failed');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Warranty_SNAP_${asOf}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadForecast() {
    const p = new URLSearchParams(snapQs);
    p.set('mode', 'forecast-export');
    p.set('scenario', scenario);
    const res = await fetch(`${API}?${p}`, { credentials: 'include' });
    if (!res.ok) {
      feedback.actionFailed('Export failed');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Warranty_Forecast_${asOf}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadClaimsTemplate() {
    const res = await fetch(`${API}?mode=claims-template`, { credentials: 'include' });
    if (!res.ok) {
      feedback.actionFailed('Template download failed');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Warranty_Claims_Template.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadUnitsTemplate() {
    const res = await fetch(`${API}?mode=units-template`, { credentials: 'include' });
    if (!res.ok) {
      feedback.actionFailed('Template download failed');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Warranty_Units_Template.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onUnitsFile(file: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setUnitsImportStatus('Importing…');
    try {
      const res = await fetch(`${API}?mode=units-import`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = (await res.json()) as {
        error?: string;
        upserted?: number;
        valid?: number;
        errorCount?: number;
      };
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setUnitsImportStatus(
        `${(data.upserted ?? 0).toLocaleString('en-IN')} upserted · ${(data.errorCount ?? 0).toLocaleString('en-IN')} rejected`
      );
      feedback.actionSuccess(
        `Imported ${(data.upserted ?? 0).toLocaleString('en-IN')} units`
      );
      cacheClearWarranty();
      void loadUnits();
      void loadSnap();
    } catch (e) {
      setUnitsImportStatus('');
      feedback.actionFailed(e instanceof Error ? e.message : 'Import failed');
    }
  }

  async function onClaimsFile(file: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setClaimPreview('Reading…');
    try {
      const res = await fetch(`${API}?mode=claims-preview`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = (await res.json()) as {
        error?: string;
        valid?: number;
        errorCount?: number;
        rows?: unknown[];
      };
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setClaimPreview(
        `${(data.valid ?? 0).toLocaleString('en-IN')} valid · ${(data.errorCount ?? 0).toLocaleString('en-IN')} rejected`
      );
      if (data.rows?.length) {
        const commit = await fetch(`${API}?mode=claims-commit`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: data.rows }),
        });
        const result = (await commit.json()) as {
          error?: string;
          inserted?: number;
          matched?: number;
        };
        if (!commit.ok) throw new Error(result.error || 'Commit failed');
        feedback.actionSuccess(
          `Imported ${result.inserted ?? 0} claims (${result.matched ?? 0} matched)`
        );
        void loadClaims();
      }
    } catch (e) {
      setClaimPreview('');
      feedback.actionFailed(e instanceof Error ? e.message : 'Import failed');
    }
  }

  async function saveAssumptionsForm() {
    if (!assumptions) return;
    const res = await fetch(`${API}?mode=assumptions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assumptions),
    });
    if (!res.ok) {
      feedback.actionFailed('Save failed');
      return;
    }
    setAssumptions((await res.json()) as WarrantyAssumptions);
    feedback.actionSuccess('Assumptions saved');
  }

  return (
    <PageShell
      title="Warranty Provision"
      subtitle="SNAP coverage · units · claim rates · cost forecast"
      icon={<Shield className="h-4 w-4" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
            <span>Period</span>
            <select
              aria-label="Month"
              value={periodYm.slice(5, 7)}
              onChange={(e) => {
                const ym = `${periodYm.slice(0, 4)}-${e.target.value}`;
                setPeriodYm(ym);
                setFyFrom(fyStartYear(asOfFromPeriodYm(ym)));
                resetPage();
              }}
              className={SELECT_CLS}
            >
              {MONTH_OPTS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Year"
              value={periodYm.slice(0, 4)}
              onChange={(e) => {
                const ym = `${e.target.value}-${periodYm.slice(5, 7)}`;
                setPeriodYm(ym);
                setFyFrom(fyStartYear(asOfFromPeriodYm(ym)));
                resetPage();
              }}
              className={SELECT_CLS}
            >
              {yearOptsAround(periodYm).map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-400">as-of {formatUiDate(asOf)}</span>
          </div>
          {(tab === 'snap' || tab === 'rates' || tab === 'forecast') && (
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input
                type="checkbox"
                checked={strict}
                onChange={(e) => setStrict(e.target.checked)}
              />
              Strict
            </label>
          )}
        </div>
      }
      toolbar={
        <div className="border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${
                  tab === t.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        {tab === 'snap' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-end gap-2 px-1">
              <label className="text-[11px] text-slate-500">
                First FY (start year)
                <input
                  type="number"
                  value={fyFrom}
                  onChange={(e) => setFyFrom(Number(e.target.value) || fyFrom)}
                  className="ml-1 h-8 w-20 rounded border border-slate-200 px-2 text-[12px]"
                />
              </label>
              <label className="text-[11px] text-slate-500">
                FY columns
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={fyCount}
                  onChange={(e) => setFyCount(Math.min(15, Math.max(1, Number(e.target.value) || 6)))}
                  className="ml-1 h-8 w-16 rounded border border-slate-200 px-2 text-[12px]"
                />
              </label>
              <button
                type="button"
                onClick={() => void downloadSnap()}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12px]"
              >
                <Download className="h-3.5 w-3.5" />
                Download Excel
              </button>
              <span className="ml-auto text-[12px] text-slate-500">
                {loading
                  ? 'Loading…'
                  : snap
                    ? `${inr(snap.totalUnits)} units · exposure ${inr(snap.grandTotal)} unit-years`
                    : ''}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden custom-scrollbar">
              <div
                className="wp-copy-grid flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas"
                {...gridSelectHandlers('snap')}
              >
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="min-w-max border-collapse text-[14px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[13px] [&_th]:font-semibold [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[14px] [&_tr]:border-0">
                    <AdminThead>
                      <tr>
                        <AdminTh>Billing year</AdminTh>
                        {(snap?.fys ?? []).map((f) => (
                          <AdminTh key={f} align="right">
                            FY {f}
                          </AdminTh>
                        ))}
                        <AdminTh align="right">FY Total Year</AdminTh>
                      </tr>
                    </AdminThead>
                    <tbody>
                      {(snap?.rows ?? []).map((r, ri) => (
                        <AdminTr key={r.year} data-row-index={ri}>
                          <AdminTd
                            className={`font-semibold ${cellSelected('snap', ri, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            {r.year || 'Unknown'}
                          </AdminTd>
                          {r.values.map((v, i) => (
                            <AdminTd
                              key={i}
                              align="right"
                              className={cellSelected('snap', ri, i + 1) ? CELL_SEL_CLS : ''}
                            >
                              {inr(v)}
                            </AdminTd>
                          ))}
                          <AdminTd
                            align="right"
                            className={cellSelected('snap', ri, r.values.length + 1) ? CELL_SEL_CLS : ''}
                          >
                            {inr(r.total)}
                          </AdminTd>
                        </AdminTr>
                      ))}
                      {snap ? (
                        <AdminTr data-row-index={snap.rows.length}>
                          <AdminTd
                            className={`font-bold ${cellSelected('snap', snap.rows.length, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            Grand Total
                          </AdminTd>
                          {snap.totals.map((v, i) => (
                            <AdminTd
                              key={i}
                              align="right"
                              className={`font-bold ${cellSelected('snap', snap.rows.length, i + 1) ? CELL_SEL_CLS : ''}`}
                            >
                              {inr(v)}
                            </AdminTd>
                          ))}
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('snap', snap.rows.length, snap.totals.length + 1) ? CELL_SEL_CLS : ''}`}
                          >
                            {inr(snap.grandTotal)}
                          </AdminTd>
                        </AdminTr>
                      ) : null}
                    </tbody>
                  </AdminTable>
                </div>
              </div>

              <div
                className="wp-copy-grid flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas"
                {...gridSelectHandlers('active')}
              >
                <div className="shrink-0 border-b border-slate-200 px-3 py-2">
                  <div className="text-[12px] font-semibold text-slate-800">
                    Active units by year
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    Active = end &gt; as-of · Mfg = LEN(serial)=14 → MID(serial,6,2)+2000 else
                    YEAR(billing date)
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="min-w-max border-collapse text-[14px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[13px] [&_th]:font-semibold [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[14px] [&_tr]:border-0">
                    <AdminThead>
                      <tr>
                        <AdminTh>Year</AdminTh>
                        <AdminTh align="right">Qty as per Mfg</AdminTh>
                        <AdminTh align="right">Qty as per Billing</AdminTh>
                      </tr>
                    </AdminThead>
                    <tbody>
                      {(activeUnits?.rows ?? []).map((r, ri) => (
                        <AdminTr key={r.year} data-row-index={ri}>
                          <AdminTd
                            className={`font-semibold ${cellSelected('active', ri, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            {r.year}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('active', ri, 1) ? CELL_SEL_CLS : ''}
                          >
                            {inrExact(r.qtyMfg)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('active', ri, 2) ? CELL_SEL_CLS : ''}
                          >
                            {inrExact(r.qtyBilling)}
                          </AdminTd>
                        </AdminTr>
                      ))}
                      {activeUnits ? (
                        <AdminTr data-row-index={activeUnits.rows.length}>
                          <AdminTd
                            className={`font-bold ${cellSelected('active', activeUnits.rows.length, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            Total
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('active', activeUnits.rows.length, 1) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(activeUnits.totalMfg)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('active', activeUnits.rows.length, 2) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(activeUnits.totalBilling)}
                          </AdminTd>
                        </AdminTr>
                      ) : null}
                    </tbody>
                  </AdminTable>
                </div>
              </div>

              <div
                className="wp-copy-grid flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas"
                {...gridSelectHandlers('breakdown')}
              >
                <div className="shrink-0 border-b border-slate-200 px-3 py-2">
                  <div className="text-[12px] font-semibold text-slate-800">
                    Breakdown solved · machines by mfg year
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    14-digit serials only · Active in warranty provision · click year for calls
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="min-w-max border-collapse text-[14px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[13px] [&_th]:font-semibold [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[14px] [&_tr]:border-0">
                    <AdminThead>
                      <tr>
                        <AdminTh>Mfg year</AdminTh>
                        <AdminTh align="right">Machines</AdminTh>
                      </tr>
                    </AdminThead>
                    <tbody>
                      {(breakdownMfg?.rows ?? []).map((r, ri) => (
                        <AdminTr
                          key={r.year}
                          data-row-index={ri}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => void openBreakdownDetail(r.year, 'wp-active')}
                        >
                          <AdminTd
                            className={`font-semibold text-sky-800 underline-offset-2 hover:underline ${cellSelected('breakdown', ri, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            {r.year}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('breakdown', ri, 1) ? CELL_SEL_CLS : ''}
                          >
                            {inrExact(r.machines)}
                          </AdminTd>
                        </AdminTr>
                      ))}
                      {breakdownMfg ? (
                        <AdminTr data-row-index={breakdownMfg.rows.length}>
                          <AdminTd
                            className={`font-bold ${cellSelected('breakdown', breakdownMfg.rows.length, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            Total
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown', breakdownMfg.rows.length, 1) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(breakdownMfg.totalMachines)}
                          </AdminTd>
                        </AdminTr>
                      ) : null}
                    </tbody>
                  </AdminTable>
                </div>
              </div>

              <div
                className="wp-copy-grid flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas"
                {...gridSelectHandlers('breakdown-wco')}
              >
                <div className="shrink-0 border-b border-slate-200 px-3 py-2">
                  <div className="text-[12px] font-semibold text-slate-800">
                    Breakdown solved · CRM WCO=W · by mfg year
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    calls_latest_hot · WCO=W · 14-digit serials · click year for calls
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="min-w-max border-collapse text-[14px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[13px] [&_th]:font-semibold [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[14px] [&_tr]:border-0">
                    <AdminThead>
                      <tr>
                        <AdminTh>Mfg year</AdminTh>
                        <AdminTh align="right">Machines</AdminTh>
                      </tr>
                    </AdminThead>
                    <tbody>
                      {(breakdownWco?.rows ?? []).map((r, ri) => (
                        <AdminTr
                          key={r.year}
                          data-row-index={ri}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => void openBreakdownDetail(r.year, 'crm-w')}
                        >
                          <AdminTd
                            className={`font-semibold text-sky-800 underline-offset-2 hover:underline ${cellSelected('breakdown-wco', ri, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            {r.year}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('breakdown-wco', ri, 1) ? CELL_SEL_CLS : ''}
                          >
                            {inrExact(r.machines)}
                          </AdminTd>
                        </AdminTr>
                      ))}
                      {breakdownWco ? (
                        <AdminTr data-row-index={breakdownWco.rows.length}>
                          <AdminTd
                            className={`font-bold ${cellSelected('breakdown-wco', breakdownWco.rows.length, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            Total
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown-wco', breakdownWco.rows.length, 1) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(breakdownWco.totalMachines)}
                          </AdminTd>
                        </AdminTr>
                      ) : null}
                    </tbody>
                  </AdminTable>
                </div>
              </div>
            </div>

            <ModalPortal open={bdDetailYear != null}>
              {bdDetailYear != null ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <ModalBackdrop
                    onClick={() => {
                      setBdDetailYear(null);
                      setBdDetail(null);
                    }}
                  />
                  <div className="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900">
                          Breakdown solved · mfg year {bdDetailYear}
                          {bdDetailBasis === 'crm-w' ? ' · CRM WCO=W' : ' · Active WP'}
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-500">
                          14-digit serials · year = 2000 + digits at positions 6–7
                          {bdDetailBasis === 'crm-w'
                            ? ' · filtered by calls_latest_hot.wco = W'
                            : ' · matched Active warranty provision'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded p-1 text-slate-500 hover:bg-slate-100"
                        onClick={() => {
                          setBdDetailYear(null);
                          setBdDetail(null);
                        }}
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto custom-scrollbar px-2 py-2">
                      {bdDetailLoading ? (
                        <div className="px-2 py-6 text-center text-[12px] text-slate-500">
                          Loading…
                        </div>
                      ) : (
                        <AdminTable className="min-w-full border-collapse text-[12px] [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1.5 [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1">
                          <AdminThead>
                            <tr>
                              <AdminTh>Serial</AdminTh>
                              <AdminTh>YY (pos 6–7)</AdminTh>
                              <AdminTh>TRN</AdminTh>
                              <AdminTh>Party</AdminTh>
                              <AdminTh>Solved</AdminTh>
                              <AdminTh>Status</AdminTh>
                            </tr>
                          </AdminThead>
                          <tbody>
                            {(bdDetail?.rows ?? []).map((r, i) => (
                              <AdminTr key={`${r.trn}-${r.serial}-${i}`}>
                                <AdminTd className="font-mono text-[11px]">{r.serial}</AdminTd>
                                <AdminTd className="font-mono">{r.yy}</AdminTd>
                                <AdminTd>{r.trn || '—'}</AdminTd>
                                <AdminTd>{r.partyName || '—'}</AdminTd>
                                <AdminTd>
                                  {r.solvedDay ? formatUiDate(r.solvedDay) : '—'}
                                </AdminTd>
                                <AdminTd>{r.statusBucket || '—'}</AdminTd>
                              </AdminTr>
                            ))}
                          </tbody>
                        </AdminTable>
                      )}
                    </div>
                    <div className="shrink-0 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
                      {bdDetailLoading
                        ? ''
                        : bdDetail
                          ? `${bdDetail.total} call(s)${bdDetail.truncated ? ' (showing first 2000)' : ''}`
                          : ''}
                    </div>
                  </div>
                </div>
              ) : null}
            </ModalPortal>
          </div>
        )}

        {tab === 'units' && (
          <>
            <div className="flex flex-wrap items-center gap-2 px-1">
              <button
                type="button"
                onClick={() => void downloadUnitsTemplate()}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12px]"
              >
                <Download className="h-3.5 w-3.5" />
                Download template
              </button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12px]">
                <Upload className="h-3.5 w-3.5" />
                Import units .xlsx
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => void onUnitsFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <span className="text-[12px] text-slate-500">{unitsImportStatus}</span>
              <span className="text-[11px] text-slate-400">
                Upserts on Billing Document + Serial · End/FY computed · .xlsx only
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2 px-1">
              <FilterSelect
                label="Material Group"
                emptyLabel="All groups"
                options={toOpts(options.materialGroups)}
                selected={materialGroup ? [materialGroup] : []}
                mode="single"
                onChange={(v) => {
                  resetPage();
                  setMaterialGroup(pickSingle(v));
                }}
                layout="inline"
                panelClassName="w-52"
              />
              <FilterSelect
                label="Status"
                emptyLabel="All"
                options={[
                  { value: 'Active', label: 'Active' },
                  { value: 'Inactive', label: 'Inactive' },
                ]}
                selected={status ? [status] : []}
                mode="single"
                onChange={(v) => {
                  resetPage();
                  setStatus(pickSingle(v));
                }}
                layout="inline"
                panelClassName="w-36"
              />
              <FilterSelect
                label="End FY"
                emptyLabel="All FY"
                options={toOpts(options.warrantyEndFys)}
                selected={warrantyEndFy ? [warrantyEndFy] : []}
                mode="single"
                onChange={(v) => {
                  resetPage();
                  setWarrantyEndFy(pickSingle(v));
                }}
                layout="inline"
                panelClassName="w-36"
              />
              <FilterSelect
                label="State"
                emptyLabel="All states"
                options={toOpts(options.states)}
                selected={state ? [state] : []}
                mode="single"
                onChange={(v) => {
                  resetPage();
                  setState(pickSingle(v));
                }}
                layout="inline"
                panelClassName="w-44"
              />
              <FilterSelect
                label="City"
                emptyLabel="All cities"
                options={toOpts(options.cities)}
                selected={city ? [city] : []}
                mode="single"
                onChange={(v) => {
                  resetPage();
                  setCity(pickSingle(v));
                }}
                layout="inline"
                panelClassName="w-44"
              />
              <FilterSelect
                label="Subgroup"
                emptyLabel="All"
                options={toOpts(options.customerSubgroups)}
                selected={customerSubgroup ? [customerSubgroup] : []}
                mode="single"
                onChange={(v) => {
                  resetPage();
                  setCustomerSubgroup(pickSingle(v));
                }}
                layout="inline"
                panelClassName="w-44"
              />
              <FilterSelect
                label="Material"
                emptyLabel="All"
                options={toOpts(options.materials)}
                selected={material ? [material] : []}
                mode="single"
                onChange={(v) => {
                  resetPage();
                  setMaterial(pickSingle(v));
                }}
                layout="inline"
                panelClassName="w-48"
              />
              <input
                value={q}
                onChange={(e) => {
                  resetPage();
                  setQ(e.target.value);
                }}
                placeholder="Search…"
                className="h-8 w-44 rounded border border-slate-200 px-2 text-[12px]"
              />
              <span className="ml-auto text-[12px] text-slate-500">
                {loading ? 'Loading…' : `${total.toLocaleString('en-IN')} row(s)`}
              </span>
            </div>
            <div
              className="wp-copy-grid min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-bg-canvas custom-scrollbar"
              {...gridSelectHandlers('units')}
            >
              <AdminTable className="w-full min-w-max">
                <AdminThead>
                  <tr>
                    <AdminTh>Billing Document</AdminTh>
                    <AdminTh>Billing Date</AdminTh>
                    <AdminTh>Material</AdminTh>
                    <AdminTh>Serial</AdminTh>
                    <AdminTh>Warranty Start</AdminTh>
                    <AdminTh align="right">Days</AdminTh>
                    <AdminTh>Warranty End</AdminTh>
                    <AdminTh align="right">Remaining</AdminTh>
                    <AdminTh>Status</AdminTh>
                    <AdminTh>End FY</AdminTh>
                  </tr>
                </AdminThead>
                <tbody>
                  {rows.map((r, ri) => (
                    <AdminTr key={r.id} data-row-index={ri}>
                      <AdminTd
                        className={`font-mono text-[11px] ${cellSelected('units', ri, 0) ? CELL_SEL_CLS : ''}`}
                      >
                        {r.billingDocument}
                      </AdminTd>
                      <AdminTd className={cellSelected('units', ri, 1) ? CELL_SEL_CLS : ''}>
                        {r.billingDate ? formatUiDate(r.billingDate) : '—'}
                      </AdminTd>
                      <AdminTd className={cellSelected('units', ri, 2) ? CELL_SEL_CLS : ''}>
                        {r.material}
                      </AdminTd>
                      <AdminTd
                        className={`font-mono text-[11px] ${cellSelected('units', ri, 3) ? CELL_SEL_CLS : ''}`}
                      >
                        {r.serialNumber}
                      </AdminTd>
                      <AdminTd className={cellSelected('units', ri, 4) ? CELL_SEL_CLS : ''}>
                        {r.warrantyStart ? formatUiDate(r.warrantyStart) : '—'}
                      </AdminTd>
                      <AdminTd
                        align="right"
                        className={cellSelected('units', ri, 5) ? CELL_SEL_CLS : ''}
                      >
                        {r.days ?? '—'}
                      </AdminTd>
                      <AdminTd className={cellSelected('units', ri, 6) ? CELL_SEL_CLS : ''}>
                        {r.warrantyEndDate ? formatUiDate(r.warrantyEndDate) : '—'}
                      </AdminTd>
                      <AdminTd
                        align="right"
                        className={cellSelected('units', ri, 7) ? CELL_SEL_CLS : ''}
                      >
                        {r.remainingDays ?? '—'}
                      </AdminTd>
                      <AdminTd
                        className={`${
                          r.warrantyStatus === 'Active'
                            ? 'font-semibold text-emerald-700'
                            : 'text-rose-700'
                        } ${cellSelected('units', ri, 8) ? CELL_SEL_CLS : ''}`}
                      >
                        {r.warrantyStatus ?? '—'}
                      </AdminTd>
                      <AdminTd className={cellSelected('units', ri, 9) ? CELL_SEL_CLS : ''}>
                        {r.warrantyEndFy || '—'}
                      </AdminTd>
                    </AdminTr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            <div className="flex shrink-0 items-center justify-between px-1 text-[12px] text-slate-600">
              <label className="flex items-center gap-1.5">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) => {
                    resetPage();
                    setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
                  }}
                  className="h-7 rounded border border-slate-200 px-1.5"
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
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'rates' && rates && (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-1">
            <p className="text-[12px] text-amber-800">
              {rates.assumptionBadge} · Exposure {inr(rates.exposureUnitYears)} unit-years (= SNAP
              Grand Total)
            </p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ['Claims', inr(rates.totalClaims)],
                ['Matched', inr(rates.matchedClaims)],
                ['Claim % (eligible)', rates.overallClaimPct?.toFixed(2) ?? '—'],
                ['Exposure claim rate', rates.exposureClaimRate?.toFixed(4) ?? '—'],
                ['Avg claim cost', rates.avgClaimCost != null ? inrMoney(rates.avgClaimCost) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-[11px] text-slate-500">{k}</div>
                  <div className="text-sm font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>Material group</AdminTh>
                  <AdminTh align="right">Units</AdminTh>
                  <AdminTh align="right">Claims</AdminTh>
                  <AdminTh align="right">Avg cost</AdminTh>
                  <AdminTh>Flag</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {rates.byMaterialGroup.map((r) => (
                  <AdminTr key={r.materialGroup}>
                    <AdminTd>{r.materialGroup}</AdminTd>
                    <AdminTd align="right">{inr(r.units)}</AdminTd>
                    <AdminTd align="right">{inr(r.claims)}</AdminTd>
                    <AdminTd align="right">{r.avgCost != null ? inrMoney(r.avgCost) : '—'}</AdminTd>
                    <AdminTd>{r.flagged ? 'n<30 fallback' : ''}</AdminTd>
                  </AdminTr>
                ))}
              </tbody>
            </AdminTable>
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>Age band</AdminTh>
                  <AdminTh align="right">Exposed</AdminTh>
                  <AdminTh align="right">Claims</AdminTh>
                  <AdminTh align="right">Hazard</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {rates.byAgeBand.map((r) => (
                  <AdminTr key={r.band}>
                    <AdminTd>{r.band}</AdminTd>
                    <AdminTd align="right">{inr(r.exposed)}</AdminTd>
                    <AdminTd align="right">{inr(r.claims)}</AdminTd>
                    <AdminTd align="right">{r.hazard != null ? r.hazard.toFixed(4) : '—'}</AdminTd>
                  </AdminTr>
                ))}
              </tbody>
            </AdminTable>
          </div>
        )}

        {tab === 'forecast' && (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-1">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
                Scenario
                <select
                  value={scenario}
                  onChange={(e) =>
                    setScenario(e.target.value as 'base' | 'optimistic' | 'pessimistic')
                  }
                  className="h-8 rounded border border-slate-200 px-2 text-[12px]"
                >
                  <option value="base">Base</option>
                  <option value="optimistic">Optimistic</option>
                  <option value="pessimistic">Pessimistic</option>
                </select>
              </label>
              <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                KPIs & table = {scenario === 'base' ? 'Base' : scenario === 'optimistic' ? 'Optimistic' : 'Pessimistic'}
              </span>
              <button
                type="button"
                onClick={() => void downloadForecast()}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12px]"
              >
                <Download className="h-3.5 w-3.5" />
                Download Excel
              </button>
            </div>
            {forecast ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {[
                    ['Under warranty', inrExact(forecast.kpis.installedUnderWarranty)],
                    ['Claims 12m', inrExact(forecast.kpis.expectedClaims12m)],
                    ['Cost 12m', inrMoneyExact(forecast.kpis.projectedCost12m)],
                    ['Cost 3y', inrMoneyExact(forecast.kpis.projectedCost3y)],
                    ['Cost 5y', inrMoneyExact(forecast.kpis.projectedCost5y)],
                    ['Provision required (Base)', inrMoneyExact(forecast.provision.required)],
                    ['Existing provision', inrMoneyExact(forecast.provision.existing)],
                    ['Provision gap', inrMoneyExact(forecast.provision.gap)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-[11px] text-slate-500">{k}</div>
                      <div
                        className={`text-sm font-semibold ${
                          k === 'Provision gap' && forecast.provision.gap > 0
                            ? 'text-rose-700'
                            : ''
                        }`}
                      >
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">{forecast.provision.note}</p>
                <div className="grid gap-2 md:grid-cols-3">
                  {(
                    [
                      ['optimistic', 'Optimistic', forecast.scenarios.optimistic],
                      ['base', 'Base', forecast.scenarios.base],
                      ['pessimistic', 'Pessimistic', forecast.scenarios.pessimistic],
                    ] as const
                  ).map(([id, label, s]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setScenario(id)}
                      className={`rounded-lg border p-3 text-left text-[12px] ${
                        scenario === id
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white hover:border-slate-400'
                      }`}
                    >
                      <div className="font-semibold">
                        {label}
                        {scenario === id ? ' · selected' : ''}
                      </div>
                      <div>Claims 12m: {inrExact(s.claims12m)}</div>
                      <div>Cost 12m: {inrMoneyExact(s.cost12m)}</div>
                    </button>
                  ))}
                </div>
                <AdminTable>
                  <AdminThead>
                    <tr>
                      <AdminTh>Month</AdminTh>
                      <AdminTh align="right">Expected claims</AdminTh>
                      <AdminTh align="right">Cost</AdminTh>
                      <AdminTh align="right">Cumulative</AdminTh>
                    </tr>
                  </AdminThead>
                  <tbody>
                    {forecast.monthly.slice(0, 24).map((m) => (
                      <AdminTr key={m.period}>
                        <AdminTd>{m.period}</AdminTd>
                        <AdminTd align="right">{m.expectedClaims.toFixed(2)}</AdminTd>
                        <AdminTd align="right">{inrMoney(m.cost)}</AdminTd>
                        <AdminTd align="right">{inrMoney(m.cumulativeCost)}</AdminTd>
                      </AdminTr>
                    ))}
                  </tbody>
                </AdminTable>
                <details className="rounded border border-slate-200 bg-white p-3 text-[12px]">
                  <summary className="cursor-pointer font-semibold">Methodology & limitations</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                    {forecast.methodology.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                    {forecast.reconciliations.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="text-[12px] text-slate-500">{loading ? 'Loading…' : 'No forecast'}</p>
            )}
          </div>
        )}

        {tab === 'claims' && (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadClaimsTemplate()}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12px]"
              >
                <Download className="h-3.5 w-3.5" />
                Download template
              </button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12px]">
                <Upload className="h-3.5 w-3.5" />
                Import claims .xlsx
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => void onClaimsFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <span className="text-[12px] text-slate-500">{claimPreview}</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search claim / serial"
                className="ml-auto h-8 w-48 rounded border border-slate-200 px-2 text-[12px]"
              />
            </div>
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>Claim No</AdminTh>
                  <AdminTh>Serial</AdminTh>
                  <AdminTh>Date</AdminTh>
                  <AdminTh align="right">Total</AdminTh>
                  <AdminTh>Match</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {(claims?.rows ?? []).map((c) => (
                  <AdminTr key={c.id}>
                    <AdminTd>{c.claimNo}</AdminTd>
                    <AdminTd className="font-mono text-[11px]">{c.serialNumber}</AdminTd>
                    <AdminTd>{c.claimDate ? formatUiDate(c.claimDate) : '—'}</AdminTd>
                    <AdminTd align="right">
                      {c.totalCost != null ? inrMoney(c.totalCost) : '—'}
                    </AdminTd>
                    <AdminTd>{c.matchStatus}</AdminTd>
                  </AdminTr>
                ))}
              </tbody>
            </AdminTable>
          </div>
        )}

        {tab === 'assumptions' && assumptions && (
          <div className="max-w-xl space-y-3 overflow-auto p-2 text-[12px]">
            {(
              [
                ['inflationPct', 'Annual inflation %'],
                ['discountPct', 'Discount rate %'],
                ['optimisticProbMult', 'Optimistic probability mult'],
                ['optimisticCostMult', 'Optimistic cost mult'],
                ['pessimisticProbMult', 'Pessimistic probability mult'],
                ['pessimisticCostMult', 'Pessimistic cost mult'],
                ['existingProvision', 'Existing provision balance'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3">
                <span>{label}</span>
                <input
                  type="number"
                  step="0.01"
                  value={assumptions[key]}
                  onChange={(e) =>
                    setAssumptions({ ...assumptions, [key]: Number(e.target.value) })
                  }
                  className="h-8 w-32 rounded border border-slate-200 px-2"
                />
              </label>
            ))}
            <label className="flex items-center justify-between gap-3">
              <span>Forecast start</span>
              <input
                type="date"
                value={assumptions.forecastStart ?? ''}
                onChange={(e) =>
                  setAssumptions({ ...assumptions, forecastStart: e.target.value || null })
                }
                className="h-8 rounded border border-slate-200 px-2"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={assumptions.includeFutureSales}
                onChange={(e) =>
                  setAssumptions({ ...assumptions, includeFutureSales: e.target.checked })
                }
              />
              Include expected future sales (excluded from accounting provision)
            </label>
            <button
              type="button"
              onClick={() => void saveAssumptionsForm()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-white"
            >
              Save assumptions
            </button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
