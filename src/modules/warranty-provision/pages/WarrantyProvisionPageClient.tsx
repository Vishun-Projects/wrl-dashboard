'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, RefreshCw, Shield, Upload, X } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import {
  AdminTable,
  AdminTd,
  AdminTfoot,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { useUser } from '@/components/layout/DashboardLayout';
import { feedback } from '@/lib/ui/feedback';
import { formatUiDate } from '@/lib/dates/ui-date';
import { isSuperAdmin } from '@/lib/auth/rbac-catalog';
import {
  asOfFromPeriodYm,
  fyStartYear,
  prevPeriodYmIst,
} from '@/modules/warranty-provision/fy';
import {
  cacheClearWarranty,
  cacheGet,
  cacheSet,
  claimsCacheKey,
  ensureWarrantyCacheVersion,
  forecastCacheKey,
  mismatchCacheKey,
  ratesCacheKey,
  snapCacheKey,
  unitsCacheKey,
  type ClaimsCachePayload,
  type SnapBundle,
} from '@/modules/warranty-provision/client-cache';
import type {
  ActiveUnitsResponse,
  BreakdownMfgDetailResponse,
  BreakdownMfgResponse,
  BreakdownMismatchResponse,
  ClaimsByMgBasis,
  ClaimsByMaterialDefectResponse,
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
const CLAIMS_PAGE_SIZES = [50, 100, 200] as const;
const MISMATCH_PAGE_SIZES = [50, 100, 200] as const;
const BD_DETAIL_PAGE_SIZES = [50, 100, 200] as const;
type Tab =
  | 'snap'
  | 'units'
  | 'rates'
  | 'forecast'
  | 'claims'
  | 'mismatched'
  | 'assumptions';
type ClaimsMeta = { syncedAt: string | null; rowCount: number; syncedBy: string };
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
  'h-9 rounded-md border border-slate-200 bg-white px-2 text-[14px] font-medium text-slate-900';

function yearOptsAround(periodYm: string): number[] {
  const cur = Number(periodYm.slice(0, 4)) || Number(prevPeriodYmIst().slice(0, 4));
  const from = cur - 10;
  const to = cur + 1;
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

function cellPlain(el: Element | null | undefined): string {
  return ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Full table (thead + tbody) → TSV + HTML for Excel paste. */
function tableClipboardPayload(root: HTMLElement): { plain: string; html: string } | null {
  const table = root.querySelector('table');
  if (!table) return null;
  const lines: string[] = [];
  const rowsHtml: string[] = [];
  const pushRow = (cells: Element[]) => {
    const texts = cells.map((c) => cellPlain(c));
    if (texts.every((t) => !t)) return;
    lines.push(texts.join('\t'));
    rowsHtml.push(
      `<tr>${texts
        .map((t) => `<td>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`)
        .join('')}</tr>`
    );
  };
  const ths = table.querySelectorAll('thead tr:first-child th, thead tr:first-child td');
  if (ths.length) pushRow([...ths]);
  table.querySelectorAll('tbody tr').forEach((tr) => {
    pushRow([...tr.querySelectorAll('td')]);
  });
  const plain = lines.join('\n');
  if (!plain) return null;
  return { plain, html: `<table>${rowsHtml.join('')}</table>` };
}

async function copyTableRoot(root: HTMLElement | null): Promise<void> {
  if (!root) return;
  const payload = tableClipboardPayload(root);
  if (!payload) {
    feedback.actionFailed('Nothing to copy');
    return;
  }
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(payload.plain);
    }
    feedback.actionSuccess('Table copied');
  } catch {
    feedback.actionFailed('Copy failed');
  }
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
function fmtMajorPct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}%`;
}

function inrExact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

function inrMoneyExact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** Total ÷ call count (Claims by MG “Cost per unit”). */
function costPerUnit(total: number, callCount: number): number | null {
  if (!(callCount > 0) || !Number.isFinite(total)) return null;
  return total / callCount;
}

const WP_TABULAR =
  'w-full border-collapse text-[16px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[14px] [&_th]:font-semibold [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[16px] [&_td]:text-slate-900 [&_tr]:border-0';

export default function WarrantyProvisionPageClient() {
  const { userProfile } = useUser();
  const canResyncClaims = isSuperAdmin(
    (userProfile?.permissions ?? []) as string[]
  );
  const [tab, setTab] = useState<Tab>('snap');
  const [periodYm, setPeriodYm] = useState(prevPeriodYmIst);
  const asOf = useMemo(() => asOfFromPeriodYm(periodYm), [periodYm]);
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
  /** Claims search draft — debounced into claimsQ before fetch. */
  const [claimsQDraft, setClaimsQDraft] = useState('');
  const [claimsQ, setClaimsQ] = useState('');
  const [claimsPage, setClaimsPage] = useState(1);
  const [claimsPageSize, setClaimsPageSize] =
    useState<(typeof CLAIMS_PAGE_SIZES)[number]>(50);
  const [claimsMeta, setClaimsMeta] = useState<ClaimsMeta | null>(null);
  const [claimsResyncing, setClaimsResyncing] = useState(false);
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
  const [claimsByMgBasis, setClaimsByMgBasis] = useState<ClaimsByMgBasis>('wp-active');
  const [claimsByMgWp, setClaimsByMgWp] =
    useState<ClaimsByMaterialDefectResponse | null>(null);
  const [claimsByMgCrm, setClaimsByMgCrm] =
    useState<ClaimsByMaterialDefectResponse | null>(null);
  const claimsByMg =
    claimsByMgBasis === 'crm-w' ? claimsByMgCrm : claimsByMgWp;
  const [bdDetailYear, setBdDetailYear] = useState<string | null>(null);
  const [bdDetailBasis, setBdDetailBasis] = useState<'wp-active' | 'crm-w'>('wp-active');
  const [bdDetailMajor, setBdDetailMajor] = useState<'' | 'major' | 'minor'>('');
  const [bdDetailPage, setBdDetailPage] = useState(1);
  const [bdDetailPageSize, setBdDetailPageSize] =
    useState<(typeof BD_DETAIL_PAGE_SIZES)[number]>(100);
  const [bdDetail, setBdDetail] = useState<BreakdownMfgDetailResponse | null>(null);
  const [bdDetailLoading, setBdDetailLoading] = useState(false);
  const [snapExportMenuOpen, setSnapExportMenuOpen] = useState(false);
  const snapExportMenuRef = useRef<HTMLDivElement | null>(null);
  const [rates, setRates] = useState<WarrantyRatesResponse | null>(null);
  const [forecast, setForecast] = useState<WarrantyForecastResponse | null>(null);
  const [scenario, setScenario] = useState<'base' | 'optimistic' | 'pessimistic'>('base');
  const [claims, setClaims] = useState<{ rows: WarrantyClaimRow[]; total: number } | null>(null);
  const [mismatch, setMismatch] = useState<BreakdownMismatchResponse | null>(null);
  const [mismatchOnlyIn, setMismatchOnlyIn] = useState<'' | 'wp' | 'crm'>('');
  const [mismatchPage, setMismatchPage] = useState(1);
  const [mismatchPageSize, setMismatchPageSize] =
    useState<(typeof MISMATCH_PAGE_SIZES)[number]>(100);
  const [assumptions, setAssumptions] = useState<WarrantyAssumptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState('Loading…');
  const [unitsImportStatus, setUnitsImportStatus] = useState<string>('');
  const [exporting, setExporting] = useState(false);

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
      fyFrom: String(fyFrom),
      fyCount: String(fyCount),
    });
    return p;
  }, [asOf, fyFrom, fyCount]);

  useEffect(() => {
    ensureWarrantyCacheVersion();
    void (async () => {
      const cached = cacheGet<WarrantyProvisionOptions>('options');
      if (cached) {
        setOptions(cached);
        return;
      }
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
    setLoadingLabel('Loading SNAP / breakdown…');
    // Incomplete bundle (missing claims-by-mg basis) → refetch.
    if (cached?.snap && cached.claimsByMgWp && cached.claimsByMgCrm) {
      setSnap(cached.snap);
      setActiveUnits(cached.active);
      setBreakdownMfg(cached.breakdown);
      setBreakdownWco(cached.breakdownWco);
      setClaimsByMgWp(cached.claimsByMgWp);
      setClaimsByMgCrm(cached.claimsByMgCrm);
      setLoading(false);
      return;
    }
    if (cached?.snap) {
      setSnap(cached.snap);
      setActiveUnits(cached.active);
      setBreakdownMfg(cached.breakdown);
      setBreakdownWco(cached.breakdownWco);
    }
    setLoading(true);
    try {
      const snapP = fetch(`${API}?mode=snap&${snapQs}`, { credentials: 'include' }).then(
        async (res) => {
          if (!res.ok) throw new Error('SNAP load failed');
          const data = (await res.json()) as SnapResponse;
          setSnap(data);
          return data;
        }
      );
      const activeP = fetch(
        `${API}?mode=active-units&asOf=${encodeURIComponent(asOf)}`,
        { credentials: 'include' }
      ).then(async (res) => {
        const data = res.ok ? ((await res.json()) as ActiveUnitsResponse) : null;
        setActiveUnits(data);
        return data;
      });
      const bdP = fetch(
        `${API}?mode=breakdown-mfg&periodYm=${encodeURIComponent(periodYm)}`,
        { credentials: 'include' }
      ).then(async (res) => {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          feedback.actionFailed(errBody?.error || `Breakdown report failed (${res.status})`);
          setBreakdownMfg(null);
          return null;
        }
        const data = (await res.json()) as BreakdownMfgResponse;
        setBreakdownMfg(data);
        return data;
      });
      const wcoP = fetch(
        `${API}?mode=breakdown-mfg-wco&periodYm=${encodeURIComponent(periodYm)}`,
        { credentials: 'include' }
      ).then(async (res) => {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          feedback.actionFailed(errBody?.error || `CRM WCO report failed (${res.status})`);
          setBreakdownWco(null);
          return null;
        }
        const data = (await res.json()) as BreakdownMfgResponse;
        setBreakdownWco(data);
        return data;
      });
      const mgWpP = fetch(
        `${API}?mode=claims-by-mg&periodYm=${encodeURIComponent(periodYm)}&basis=wp-active`,
        { credentials: 'include' }
      ).then(async (res) => {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          feedback.actionFailed(errBody?.error || `Claims by MG (WP) failed (${res.status})`);
          setClaimsByMgWp(null);
          return null;
        }
        const data = (await res.json()) as ClaimsByMaterialDefectResponse;
        setClaimsByMgWp(data);
        return data;
      });
      const mgCrmP = fetch(
        `${API}?mode=claims-by-mg&periodYm=${encodeURIComponent(periodYm)}&basis=crm-w`,
        { credentials: 'include' }
      ).then(async (res) => {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          feedback.actionFailed(errBody?.error || `Claims by MG (CRM) failed (${res.status})`);
          setClaimsByMgCrm(null);
          return null;
        }
        const data = (await res.json()) as ClaimsByMaterialDefectResponse;
        setClaimsByMgCrm(data);
        return data;
      });

      const [snapData, activeData, bdData, wcoData, mgWpData, mgCrmData] = await Promise.all([
        snapP,
        activeP,
        bdP,
        wcoP,
        mgWpP,
        mgCrmP,
      ]);
      cacheSet(key, {
        snap: snapData,
        active: activeData,
        breakdown: bdData,
        breakdownWco: wcoData,
        claimsByMgWp: mgWpData,
        claimsByMgCrm: mgCrmData,
      });
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'SNAP failed');
    } finally {
      setLoading(false);
    }
  }, [snapQs, asOf, periodYm]);

  const openBreakdownDetail = useCallback(
    (
      year: number,
      basis: 'wp-active' | 'crm-w',
      majorFilter: '' | 'major' | 'minor' = ''
    ) => {
      setBdDetailYear(String(year));
      setBdDetailBasis(basis);
      setBdDetailMajor(majorFilter);
      setBdDetailPage(1);
      setBdDetail(null);
    },
    []
  );

  useEffect(() => {
    if (!bdDetailYear) return;
    let cancelled = false;
    setBdDetailLoading(true);
    const mode =
      bdDetailBasis === 'crm-w' ? 'breakdown-mfg-wco-detail' : 'breakdown-mfg-detail';
    const params = new URLSearchParams({
      mode,
      periodYm,
      year: bdDetailYear,
      page: String(bdDetailPage),
      pageSize: String(bdDetailPageSize),
    });
    if (bdDetailMajor) params.set('major', bdDetailMajor);
    void (async () => {
      try {
        const res = await fetch(`${API}?${params}`, { credentials: 'include' });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errBody?.error || `Detail failed (${res.status})`);
        }
        const data = (await res.json()) as BreakdownMfgDetailResponse;
        if (!cancelled) setBdDetail(data);
      } catch (e) {
        if (!cancelled) {
          setBdDetailYear(null);
          setBdDetailMajor('');
          setBdDetail(null);
          feedback.actionFailed(e instanceof Error ? e.message : 'Detail failed');
        }
      } finally {
        if (!cancelled) setBdDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    bdDetailYear,
    bdDetailBasis,
    bdDetailMajor,
    bdDetailPage,
    bdDetailPageSize,
    periodYm,
  ]);

  useEffect(() => {
    if (!snapExportMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!snapExportMenuRef.current?.contains(e.target as Node)) {
        setSnapExportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSnapExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [snapExportMenuOpen]);

  async function downloadBreakdownDetail() {
    if (!bdDetailYear) return;
    const mode =
      bdDetailBasis === 'crm-w'
        ? 'breakdown-mfg-wco-detail-export'
        : 'breakdown-mfg-detail-export';
    const params = new URLSearchParams({
      mode,
      periodYm,
      year: bdDetailYear,
    });
    if (bdDetailMajor) params.set('major', bdDetailMajor);
    const tag =
      bdDetailMajor === 'major' ? '_Major' : bdDetailMajor === 'minor' ? '_Minor' : '';
    const basis = bdDetailBasis === 'crm-w' ? 'CRM_WCO' : 'Active_WP';
    await downloadExcel({
      label: 'Breakdown calls Excel',
      url: `${API}?${params}`,
      filename: `Warranty_BD_${basis}_${periodYm}_Y${bdDetailYear}${tag}.xlsx`,
    });
  }

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
    setLoadingLabel('Loading units…');
    if (cached) {
      setRowsData(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Units load failed');
      const data = (await res.json()) as WarrantyProvisionRowsResponse;
      setRowsData(data);
      cacheSet(key, data);
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Load failed');
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
    const key = ratesCacheKey(snapQs.toString());
    const cached = cacheGet<WarrantyRatesResponse>(key);
    setLoadingLabel('Loading claim rates…');
    if (cached) {
      setRates(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}?mode=rates&${snapQs}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Rates load failed');
      const data = (await res.json()) as WarrantyRatesResponse;
      setRates(data);
      cacheSet(key, data);
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Rates failed');
    } finally {
      setLoading(false);
    }
  }, [snapQs]);

  const loadForecast = useCallback(async () => {
    const p = new URLSearchParams(snapQs);
    p.set('mode', 'forecast');
    p.set('scenario', scenario);
    const key = forecastCacheKey(snapQs.toString(), scenario);
    const cached = cacheGet<WarrantyForecastResponse>(key);
    setLoadingLabel('Loading cost forecast…');
    if (cached) {
      setForecast(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}?${p}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Forecast load failed');
      const data = (await res.json()) as WarrantyForecastResponse;
      setForecast(data);
      cacheSet(key, data);
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Forecast failed');
    } finally {
      setLoading(false);
    }
  }, [snapQs, scenario]);

  const loadClaims = useCallback(async () => {
    const key = claimsCacheKey(periodYm, claimsQ, claimsPage, claimsPageSize);
    const cached = cacheGet<ClaimsCachePayload>(key);
    setLoadingLabel(
      claimsQ.trim()
        ? `Searching claims for “${claimsQ.trim()}”…`
        : `Loading claims for ${periodYm}…`
    );
    if (cached) {
      setClaims(cached);
      if (cached.meta) setClaimsMeta(cached.meta);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API}?mode=claims&periodYm=${encodeURIComponent(periodYm)}&page=${claimsPage}&pageSize=${claimsPageSize}&q=${encodeURIComponent(claimsQ)}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Claims load failed');
      const data = (await res.json()) as ClaimsCachePayload;
      setClaims(data);
      if (data.meta) setClaimsMeta(data.meta);
      cacheSet(key, data);
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Claims failed');
    } finally {
      setLoading(false);
    }
  }, [periodYm, claimsQ, claimsPage, claimsPageSize]);

  const resyncClaims = useCallback(async () => {
    if (!canResyncClaims || claimsResyncing) return;
    setClaimsResyncing(true);
    setLoadingLabel(
      'Resyncing claims + mismatch backfill for all months…'
    );
    setLoading(true);
    try {
      const res = await fetch(`${API}?mode=claims-resync`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodYm }),
      });
      const data = (await res.json()) as ClaimsMeta & {
        error?: string;
        mismatch?: { rowCount?: number; totalRows?: number; periods?: number };
      };
      if (!res.ok) throw new Error(data.error || 'Resync failed');
      setClaimsMeta(data);
      cacheClearWarranty();
      const mismatchN = data.mismatch?.totalRows ?? data.mismatch?.rowCount ?? 0;
      const periods = data.mismatch?.periods ?? 0;
      feedback.actionSuccess(
        `Synced · claims ${(data.rowCount ?? 0).toLocaleString('en-IN')} · mismatch ${mismatchN.toLocaleString('en-IN')} across ${periods} months`
      );
      setClaimsPage(1);
      setMismatchPage(1);
      const listRes = await fetch(
        `${API}?mode=claims&periodYm=${encodeURIComponent(periodYm)}&page=1&pageSize=${claimsPageSize}&q=${encodeURIComponent(claimsQ)}`,
        { credentials: 'include' }
      );
      if (!listRes.ok) throw new Error('Claims reload failed');
      const listData = (await listRes.json()) as ClaimsCachePayload;
      setClaims(listData);
      if (listData.meta) setClaimsMeta(listData.meta);
      cacheSet(claimsCacheKey(periodYm, claimsQ, 1, claimsPageSize), listData);

      const mismatchParams = new URLSearchParams({
        mode: 'breakdown-mismatch',
        periodYm,
        page: '1',
        pageSize: String(mismatchPageSize),
      });
      if (mismatchOnlyIn) mismatchParams.set('onlyIn', mismatchOnlyIn);
      const mismatchRes = await fetch(`${API}?${mismatchParams}`, {
        credentials: 'include',
      });
      if (mismatchRes.ok) {
        const mismatchData = (await mismatchRes.json()) as BreakdownMismatchResponse;
        setMismatch(mismatchData);
        cacheSet(
          mismatchCacheKey(periodYm, mismatchOnlyIn, 1, mismatchPageSize),
          mismatchData
        );
      }
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Resync failed');
    } finally {
      setClaimsResyncing(false);
      setLoading(false);
    }
  }, [
    canResyncClaims,
    claimsResyncing,
    periodYm,
    claimsPageSize,
    claimsQ,
    mismatchOnlyIn,
    mismatchPageSize,
  ]);

  const loadAssumptions = useCallback(async () => {
    setLoadingLabel('Loading assumptions…');
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

  const loadMismatch = useCallback(async () => {
    const key = mismatchCacheKey(periodYm, mismatchOnlyIn, mismatchPage, mismatchPageSize);
    const cached = cacheGet<BreakdownMismatchResponse>(key);
    setLoadingLabel(`Loading mismatched calls for ${periodYm}…`);
    if (cached) {
      setMismatch(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        mode: 'breakdown-mismatch',
        periodYm,
        page: String(mismatchPage),
        pageSize: String(mismatchPageSize),
      });
      if (mismatchOnlyIn) params.set('onlyIn', mismatchOnlyIn);
      const res = await fetch(`${API}?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Mismatch load failed');
      const data = (await res.json()) as BreakdownMismatchResponse;
      setMismatch(data);
      cacheSet(key, data);
    } catch (e) {
      feedback.actionFailed(e instanceof Error ? e.message : 'Mismatch failed');
    } finally {
      setLoading(false);
    }
  }, [periodYm, mismatchOnlyIn, mismatchPage, mismatchPageSize]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = claimsQDraft.trim();
      setClaimsQ(next);
      setClaimsPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [claimsQDraft]);

  useEffect(() => {
    setClaimsPage(1);
    setMismatchPage(1);
  }, [periodYm]);

  useEffect(() => {
    if (tab === 'snap') {
      setLoadingLabel('Loading SNAP / breakdown…');
      void loadSnap();
    } else if (tab === 'units') {
      setLoadingLabel('Loading units…');
      void loadUnits();
    } else if (tab === 'rates') void loadRates();
    else if (tab === 'forecast') void loadForecast();
    else if (tab === 'claims') void loadClaims();
    else if (tab === 'mismatched') void loadMismatch();
    else if (tab === 'assumptions') void loadAssumptions();
  }, [
    tab,
    loadSnap,
    loadUnits,
    loadRates,
    loadForecast,
    loadClaims,
    loadMismatch,
    loadAssumptions,
  ]);

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
  // listen on document and write TSV (+ HTML table) from the highlighted range (with header).
  useEffect(() => {
    if (!colSel) return;
    const onCopy = (e: ClipboardEvent) => {
      const sel = colSelRef.current;
      const root = copyRootRef.current;
      if (!sel || !root) return;
      const lines: string[] = [];
      const rowsHtml: string[] = [];
      const thRow = root.querySelector('thead tr');
      if (thRow) {
        const headers: string[] = [];
        const ths: string[] = [];
        for (let c = sel.colLo; c <= sel.colHi; c++) {
          const text = cellPlain(thRow.children[c]);
          headers.push(text);
          ths.push(`<th>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</th>`);
        }
        lines.push(headers.join('\t'));
        rowsHtml.push(`<tr>${ths.join('')}</tr>`);
      }
      for (let r = sel.rowLo; r <= sel.rowHi; r++) {
        const tr = root.querySelector(`tbody tr[data-row-index="${r}"]`);
        if (!tr) continue;
        const cells: string[] = [];
        const tds: string[] = [];
        for (let c = sel.colLo; c <= sel.colHi; c++) {
          const text = cellPlain(tr.children[c]);
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

  const snapGridRef = useRef<HTMLDivElement>(null);
  const activeGridRef = useRef<HTMLDivElement>(null);
  const breakdownGridRef = useRef<HTMLDivElement>(null);
  const breakdownWcoGridRef = useRef<HTMLDivElement>(null);
  const claimsByMgGridRef = useRef<HTMLDivElement>(null);
  const unitsGridRef = useRef<HTMLDivElement>(null);

  function copyTableBtn(gridRef: RefObject<HTMLDivElement | null>) {
    return (
      <button
        type="button"
        title="Copy table (with headers)"
        onClick={(e) => {
          e.stopPropagation();
          void copyTableRoot(gridRef.current);
        }}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-900 hover:bg-slate-50"
      >
        <Copy className="h-3.5 w-3.5" />
        Copy
      </button>
    );
  }

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
  const claimsTotal = claims?.total ?? 0;
  const claimsTotalPages = Math.max(1, Math.ceil(claimsTotal / claimsPageSize));
  const mismatchTotal = mismatch?.total ?? 0;
  const mismatchTotalPages = Math.max(1, Math.ceil(mismatchTotal / mismatchPageSize));
  const bdDetailTotal = bdDetail?.total ?? 0;
  const bdDetailTotalPages = Math.max(1, Math.ceil(bdDetailTotal / bdDetailPageSize));

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'snap', label: 'SNAP Report' },
    { id: 'units', label: 'Units' },
    { id: 'rates', label: 'Claim rates' },
    { id: 'forecast', label: 'Cost forecast' },
    { id: 'claims', label: 'Claims' },
    { id: 'mismatched', label: 'Mismatched' },
    { id: 'assumptions', label: 'Assumptions' },
  ];

  async function downloadExcel(opts: {
    label: string;
    url: string;
    filename: string;
  }) {
    if (exporting) return;
    setExporting(true);
    const toastId = feedback.loading(`Preparing ${opts.label}…`);
    try {
      const res = await fetch(opts.url, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = opts.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      feedback.loadingSuccess(toastId, `${opts.label} downloaded`);
    } catch (e) {
      feedback.loadingFailed(
        toastId,
        e instanceof Error ? e.message : 'Export failed'
      );
    } finally {
      setExporting(false);
    }
  }

  type SnapExportKind = 'snap' | 'active' | 'bd-wp' | 'bd-crm' | 'claims-mg';

  async function downloadSnapReport(kind: SnapExportKind) {
    setSnapExportMenuOpen(false);
    if (kind === 'snap') {
      await downloadExcel({
        label: 'SNAP coverage',
        url: `${API}?mode=snap-export&${snapQs}`,
        filename: `Warranty_SNAP_${asOf}.xlsx`,
      });
      return;
    }
    if (kind === 'active') {
      await downloadExcel({
        label: 'Active units',
        url: `${API}?mode=active-units-export&asOf=${encodeURIComponent(asOf)}`,
        filename: `Warranty_ActiveUnits_${asOf}.xlsx`,
      });
      return;
    }
    if (kind === 'claims-mg') {
      const tag = claimsByMgBasis === 'crm-w' ? 'CRM_WCO' : 'Active_WP';
      await downloadExcel({
        label: 'Claims by material group',
        url: `${API}?mode=claims-by-mg-export&periodYm=${encodeURIComponent(periodYm)}&basis=${claimsByMgBasis}`,
        filename: `Warranty_ClaimsByMG_${tag}_${periodYm}.xlsx`,
      });
      return;
    }
    const crm = kind === 'bd-crm';
    const mode = crm ? 'breakdown-mfg-wco-detail-export' : 'breakdown-mfg-detail-export';
    const basis = crm ? 'CRM_WCO' : 'Active_WP';
    const params = new URLSearchParams({
      mode,
      periodYm,
      year: 'ALL',
    });
    await downloadExcel({
      label: crm ? 'Breakdown CRM WCO=W calls' : 'Breakdown Active WP calls',
      url: `${API}?${params}`,
      filename: `Warranty_BD_${basis}_${periodYm}_AllYears.xlsx`,
    });
  }

  async function downloadForecast() {
    const p = new URLSearchParams(snapQs);
    p.set('mode', 'forecast-export');
    p.set('scenario', scenario);
    await downloadExcel({
      label: 'Forecast Excel',
      url: `${API}?${p}`,
      filename: `Warranty_Forecast_${asOf}.xlsx`,
    });
  }

  async function downloadMismatch() {
    const params = new URLSearchParams({
      mode: 'breakdown-mismatch-export',
      periodYm,
    });
    if (mismatchOnlyIn) params.set('onlyIn', mismatchOnlyIn);
    const filter =
      mismatchOnlyIn === 'wp' ? '_WP' : mismatchOnlyIn === 'crm' ? '_CRM' : '';
    await downloadExcel({
      label: 'Mismatch Excel',
      url: `${API}?${params}`,
      filename: `Warranty_Mismatch_${periodYm}${filter}.xlsx`,
    });
  }

  async function downloadUnitsTemplate() {
    await downloadExcel({
      label: 'Units template',
      url: `${API}?mode=units-template`,
      filename: 'Warranty_Units_Template.xlsx',
    });
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
      title={
        <span className="block text-[18px] font-semibold leading-tight text-slate-900">
          Warranty Provision
        </span>
      }
      subtitle={undefined}
      icon={<Shield className="h-4 w-4" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium text-slate-900">
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
            <span className="text-[13px] font-medium text-slate-800">
              as-of {formatUiDate(asOf)}
            </span>
          </div>
        </div>
      }
      toolbar={
        <div className="border-b border-slate-200 bg-bg-canvas px-3 py-2">
          <p className="mb-1.5 text-[13px] font-medium text-slate-800">
            SNAP coverage · units · claim rates · cost forecast
          </p>
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-[14px] font-semibold ${
                  tab === t.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-800 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2 text-slate-900">
        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[14px] text-sky-900"
          >
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
              aria-hidden
            />
            <span className="font-medium">{loadingLabel}</span>
            <span className="text-sky-700/80">Loading...</span>
          </div>
        ) : null}
        {tab === 'snap' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-end gap-2 px-1">
              <label className="text-[13px] text-slate-900">
                First FY (start year)
                <input
                  type="number"
                  value={fyFrom}
                  onChange={(e) => setFyFrom(Number(e.target.value) || fyFrom)}
                  className="ml-1 h-8 w-20 rounded border border-slate-200 px-2 text-[14px]"
                />
              </label>
              <label className="text-[13px] text-slate-900">
                FY columns
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={fyCount}
                  onChange={(e) => setFyCount(Math.min(15, Math.max(1, Number(e.target.value) || 6)))}
                  className="ml-1 h-8 w-16 rounded border border-slate-200 px-2 text-[14px]"
                />
              </label>
              <div className="relative" ref={snapExportMenuRef}>
                <button
                  type="button"
                  onClick={() => setSnapExportMenuOpen((o) => !o)}
                  disabled={exporting}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] disabled:opacity-50"
                  aria-haspopup="menu"
                  aria-expanded={snapExportMenuOpen}
                >
                  <Download className={`h-3.5 w-3.5 ${exporting ? 'animate-pulse' : ''}`} />
                  {exporting ? 'Preparing…' : 'Download Excel'}
                </button>
                {snapExportMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    {(
                      [
                        {
                          kind: 'snap' as const,
                          title: 'SNAP coverage',
                          hint: 'Matrix on screen (billing year × FY)',
                        },
                        {
                          kind: 'active' as const,
                          title: 'Active units by year',
                          hint: 'Mfg / billing year totals on screen',
                        },
                        {
                          kind: 'bd-wp' as const,
                          title: 'Breakdown · Active WP — call dump',
                          hint: 'All solved Breakdown calls that feed the year table',
                        },
                        {
                          kind: 'bd-crm' as const,
                          title: 'Breakdown · CRM WCO=W — call dump',
                          hint: 'All WCO=W solved Breakdown calls for the period',
                        },
                        {
                          kind: 'claims-mg' as const,
                          title: 'Claims by material group',
                          hint: 'Unique units, major/minor, costs for the period',
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.kind}
                        type="button"
                        role="menuitem"
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => void downloadSnapReport(opt.kind)}
                      >
                        <span className="text-[14px] font-medium text-slate-800">
                          {opt.title}
                        </span>
                        <span className="text-[13px] leading-snug text-slate-900">
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <span className="ml-auto text-[14px] text-slate-900">
                {loading
                  ? 'Loading…'
                  : snap
                    ? `${inr(snap.totalUnits)} units · exposure ${inr(snap.grandTotal)} unit-years`
                    : ''}
              </span>
            </div>
            <div className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex min-h-0 w-full flex-[3] items-stretch gap-3 overflow-x-auto overflow-y-hidden custom-scrollbar">
              <div
                ref={snapGridRef}
                className="wp-copy-grid flex min-h-0 min-w-0 flex-[2] flex-col overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas"
                {...gridSelectHandlers('snap')}
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <div className="min-w-0 text-[15px] font-semibold text-slate-900">
                    SNAP coverage
                  </div>
                  {copyTableBtn(snapGridRef)}
                </div>
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="w-full border-collapse text-[16px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[14px] [&_th]:font-semibold [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[16px] [&_td]:text-slate-900 [&_tr]:border-0">
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
                    </tbody>
                    {snap ? (
                      <AdminTfoot>
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
                      </AdminTfoot>
                    ) : null}
                  </AdminTable>
                </div>
              </div>

              <div
                ref={activeGridRef}
                className="wp-copy-grid flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas"
                {...gridSelectHandlers('active')}
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-slate-900">
                      Active units by year
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug text-slate-800">
                      Active = end &gt; as-of · Mfg = LEN(serial)=14 → MID+2000 else billing year
                    </div>
                  </div>
                  {copyTableBtn(activeGridRef)}
                </div>
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="w-full border-collapse text-[16px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[14px] [&_th]:font-semibold [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[16px] [&_td]:text-slate-900 [&_tr]:border-0">
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
                    </tbody>
                    {activeUnits ? (
                      <AdminTfoot>
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
                      </AdminTfoot>
                    ) : null}
                  </AdminTable>
                </div>
              </div>

              <div
                ref={breakdownGridRef}
                className={`wp-copy-grid flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-bg-canvas transition-[border-color,box-shadow] duration-200 ${
                  claimsByMgBasis === 'wp-active'
                    ? 'border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
                    : 'border-slate-300'
                }`}
                {...gridSelectHandlers('breakdown')}
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[15px] font-semibold text-slate-900">
                        Breakdown solved · machines by mfg year
                      </div>
                      {claimsByMgBasis === 'wp-active' ? (
                        <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[13px] font-semibold text-sky-950">
                          Claims by Material Group source
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug text-slate-800">
                      14-digit · Active WP · click year / Major / Minor for calls
                    </div>
                  </div>
                  {copyTableBtn(breakdownGridRef)}
                </div>
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="w-full border-collapse text-[16px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[14px] [&_th]:font-semibold [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[16px] [&_td]:text-slate-900 [&_tr]:border-0">
                    <AdminThead>
                      <tr>
                        <AdminTh>Mfg year</AdminTh>
                        <AdminTh align="right">Machines</AdminTh>
                        <AdminTh align="right">Major</AdminTh>
                        <AdminTh align="right">Minor</AdminTh>
                        <AdminTh align="right">Major %</AdminTh>
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
                            className={`font-semibold text-sky-950 underline-offset-2 hover:underline ${cellSelected('breakdown', ri, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            {r.year}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('breakdown', ri, 1) ? CELL_SEL_CLS : ''}
                          >
                            {inrExact(r.machines)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`text-sky-950 underline-offset-2 hover:underline ${cellSelected('breakdown', ri, 2) ? CELL_SEL_CLS : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void openBreakdownDetail(r.year, 'wp-active', 'major');
                            }}
                          >
                            {inrExact(r.majorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`text-sky-950 underline-offset-2 hover:underline ${cellSelected('breakdown', ri, 3) ? CELL_SEL_CLS : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void openBreakdownDetail(r.year, 'wp-active', 'minor');
                            }}
                          >
                            {inrExact(r.minorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('breakdown', ri, 4) ? CELL_SEL_CLS : ''}
                          >
                            {fmtMajorPct(r.majorPct)}
                          </AdminTd>
                        </AdminTr>
                      ))}
                    </tbody>
                    {breakdownMfg ? (
                      <AdminTfoot>
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
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown', breakdownMfg.rows.length, 2) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(breakdownMfg.totalMajorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown', breakdownMfg.rows.length, 3) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(breakdownMfg.totalMinorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown', breakdownMfg.rows.length, 4) ? CELL_SEL_CLS : ''}`}
                          >
                            {fmtMajorPct(breakdownMfg.totalMajorPct)}
                          </AdminTd>
                        </AdminTr>
                      </AdminTfoot>
                    ) : null}
                  </AdminTable>
                </div>
              </div>

              <div
                ref={breakdownWcoGridRef}
                className={`wp-copy-grid flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-bg-canvas transition-[border-color,box-shadow] duration-200 ${
                  claimsByMgBasis === 'crm-w'
                    ? 'border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
                    : 'border-slate-300'
                }`}
                {...gridSelectHandlers('breakdown-wco')}
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[15px] font-semibold text-slate-900">
                        Breakdown solved · CRM WCO=W · by mfg year
                      </div>
                      {claimsByMgBasis === 'crm-w' ? (
                        <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[13px] font-semibold text-sky-950">
                          Claims by Material Group source
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug text-slate-800">
                      hot · WCO=W · 14-digit · click year / Major / Minor for calls
                    </div>
                  </div>
                  {copyTableBtn(breakdownWcoGridRef)}
                </div>
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <AdminTable className="w-full border-collapse text-[16px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[14px] [&_th]:font-semibold [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[16px] [&_td]:text-slate-900 [&_tr]:border-0">
                    <AdminThead>
                      <tr>
                        <AdminTh>Mfg year</AdminTh>
                        <AdminTh align="right">Machines</AdminTh>
                        <AdminTh align="right">Major</AdminTh>
                        <AdminTh align="right">Minor</AdminTh>
                        <AdminTh align="right">Major %</AdminTh>
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
                            className={`font-semibold text-sky-950 underline-offset-2 hover:underline ${cellSelected('breakdown-wco', ri, 0) ? CELL_SEL_CLS : ''}`}
                          >
                            {r.year}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('breakdown-wco', ri, 1) ? CELL_SEL_CLS : ''}
                          >
                            {inrExact(r.machines)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`text-sky-950 underline-offset-2 hover:underline ${cellSelected('breakdown-wco', ri, 2) ? CELL_SEL_CLS : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void openBreakdownDetail(r.year, 'crm-w', 'major');
                            }}
                          >
                            {inrExact(r.majorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`text-sky-950 underline-offset-2 hover:underline ${cellSelected('breakdown-wco', ri, 3) ? CELL_SEL_CLS : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void openBreakdownDetail(r.year, 'crm-w', 'minor');
                            }}
                          >
                            {inrExact(r.minorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={cellSelected('breakdown-wco', ri, 4) ? CELL_SEL_CLS : ''}
                          >
                            {fmtMajorPct(r.majorPct)}
                          </AdminTd>
                        </AdminTr>
                      ))}
                    </tbody>
                    {breakdownWco ? (
                      <AdminTfoot>
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
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown-wco', breakdownWco.rows.length, 2) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(breakdownWco.totalMajorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown-wco', breakdownWco.rows.length, 3) ? CELL_SEL_CLS : ''}`}
                          >
                            {inrExact(breakdownWco.totalMinorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${cellSelected('breakdown-wco', breakdownWco.rows.length, 4) ? CELL_SEL_CLS : ''}`}
                          >
                            {fmtMajorPct(breakdownWco.totalMajorPct)}
                          </AdminTd>
                        </AdminTr>
                      </AdminTfoot>
                    ) : null}
                  </AdminTable>
                </div>
              </div>
            </div>

              <div
                ref={claimsByMgGridRef}
                className="wp-copy-grid flex max-h-[42%] min-h-[10rem] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas"
                {...gridSelectHandlers('claims-by-mg')}
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-slate-900">
                      Claims by material group
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug text-slate-800">
                      {periodYm} · call set from{' '}
                      {claimsByMgBasis === 'crm-w'
                        ? 'Breakdown · CRM WCO=W'
                        : 'Breakdown · Active WP'}{' '}
                      · costs from claim facts
                      {claimsByMg ? (
                        <>
                          {' '}
                          · Major {inrExact(claimsByMg.totals.majorCalls)} · Minor{' '}
                          {inrExact(claimsByMg.totals.minorCalls)}
                        </>
                      ) : null}
                    </div>
                    <div
                      role="radiogroup"
                      aria-label="Claims by material group call set"
                      className="relative mt-2 inline-grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                        e.preventDefault();
                        setClaimsByMgBasis(
                          e.key === 'ArrowLeft' ? 'wp-active' : 'crm-w',
                        );
                      }}
                    >
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-white shadow-sm ring-1 ring-slate-200/80 transition-transform duration-200 ease-out ${
                          claimsByMgBasis === 'crm-w'
                            ? 'translate-x-full'
                            : 'translate-x-0'
                        }`}
                      />
                      <button
                        type="button"
                        role="radio"
                        aria-checked={claimsByMgBasis === 'wp-active'}
                        onClick={() => setClaimsByMgBasis('wp-active')}
                        className={`relative z-10 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          claimsByMgBasis === 'wp-active'
                            ? 'font-semibold text-slate-900'
                            : 'font-medium text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <span className="block leading-tight">Machines by mfg year</span>
                        <span
                          className={`mt-0.5 block text-[13px] font-normal ${
                            claimsByMgBasis === 'wp-active'
                              ? 'text-slate-800'
                              : 'text-slate-700'
                          }`}
                        >
                          Active WP
                          {claimsByMgWp
                            ? ` · ${inrExact(claimsByMgWp.totals.majorCalls)} / ${inrExact(claimsByMgWp.totals.minorCalls)}`
                            : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={claimsByMgBasis === 'crm-w'}
                        onClick={() => setClaimsByMgBasis('crm-w')}
                        className={`relative z-10 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          claimsByMgBasis === 'crm-w'
                            ? 'font-semibold text-slate-900'
                            : 'font-medium text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <span className="block leading-tight">CRM WCO=W by mfg year</span>
                        <span
                          className={`mt-0.5 block text-[13px] font-normal ${
                            claimsByMgBasis === 'crm-w'
                              ? 'text-slate-800'
                              : 'text-slate-700'
                          }`}
                        >
                          CRM WCO=W
                          {claimsByMgCrm
                            ? ` · ${inrExact(claimsByMgCrm.totals.majorCalls)} / ${inrExact(claimsByMgCrm.totals.minorCalls)}`
                            : ''}
                        </span>
                      </button>
                    </div>
                  </div>
                  {copyTableBtn(claimsByMgGridRef)}
                </div>
                <div
                  key={claimsByMgBasis}
                  className="min-h-0 flex-1 overflow-auto custom-scrollbar"
                >
                  <AdminTable className="w-full border-collapse text-[15px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-[14px] [&_th]:font-semibold [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-300 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-[15px] [&_td]:text-slate-900 [&_tr]:border-0">
                    <AdminThead>
                      <tr>
                        <AdminTh>Material group</AdminTh>
                        <AdminTh align="right">Unique units</AdminTh>
                        <AdminTh align="right">Call count</AdminTh>
                        <AdminTh align="right">Major</AdminTh>
                        <AdminTh align="right">Minor</AdminTh>
                        <AdminTh align="right">Repair cost</AdminTh>
                        <AdminTh align="right">Traveling reimbursement</AdminTh>
                        <AdminTh align="right">Spare parts</AdminTh>
                        <AdminTh align="right">Total</AdminTh>
                        <AdminTh align="right">Cost per unit</AdminTh>
                      </tr>
                    </AdminThead>
                    <tbody>
                      {(claimsByMg?.rows ?? []).map((r, ri) => {
                        const cpu = costPerUnit(r.totalCost, r.callCount);
                        return (
                        <AdminTr key={`${r.materialGroup}|${ri}`} data-row-index={ri}>
                          <AdminTd
                            className={
                              cellSelected('claims-by-mg', ri, 0) ? CELL_SEL_CLS : ''
                            }
                          >
                            {r.materialGroup}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 1) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrExact(r.uniqueUnits)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 2) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrExact(r.callCount)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 3) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrExact(r.majorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 4) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrExact(r.minorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 5) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrMoney(r.repairCost)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 6) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrMoney(r.travelingReimbursement)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 7) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrMoney(r.sparePartsCost)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 8) ? CELL_SEL_CLS : ''
                            }
                          >
                            {inrMoney(r.totalCost)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={
                              cellSelected('claims-by-mg', ri, 9) ? CELL_SEL_CLS : ''
                            }
                          >
                            {cpu != null ? inrMoney(cpu) : '—'}
                          </AdminTd>
                        </AdminTr>
                        );
                      })}
                    </tbody>
                    {claimsByMg ? (
                      <AdminTfoot>
                        <AdminTr data-row-index={claimsByMg.rows.length}>
                          <AdminTd
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 0)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            Total
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 1)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrExact(claimsByMg.totals.uniqueUnits)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 2)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrExact(claimsByMg.totals.callCount)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 3)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrExact(claimsByMg.totals.majorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 4)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrExact(claimsByMg.totals.minorCalls)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 5)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrMoney(claimsByMg.totals.repairCost)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 6)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrMoney(claimsByMg.totals.travelingReimbursement)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 7)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrMoney(claimsByMg.totals.sparePartsCost)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 8)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {inrMoney(claimsByMg.totals.totalCost)}
                          </AdminTd>
                          <AdminTd
                            align="right"
                            className={`font-bold ${
                              cellSelected('claims-by-mg', claimsByMg.rows.length, 9)
                                ? CELL_SEL_CLS
                                : ''
                            }`}
                          >
                            {(() => {
                              const cpu = costPerUnit(
                                claimsByMg.totals.totalCost,
                                claimsByMg.totals.callCount,
                              );
                              return cpu != null ? inrMoney(cpu) : '—';
                            })()}
                          </AdminTd>
                        </AdminTr>
                      </AdminTfoot>
                    ) : null}
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
                      setBdDetailMajor('');
                      setBdDetail(null);
                    }}
                  />
                  <div className="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900">
                          Breakdown solved · mfg year {bdDetailYear}
                          {bdDetailBasis === 'crm-w' ? ' · CRM WCO=W' : ' · Active WP'}
                          {bdDetailMajor === 'major'
                            ? ' · Major only'
                            : bdDetailMajor === 'minor'
                              ? ' · Minor only'
                              : ''}
                        </h2>
                        <p className="mt-1 text-[13px] text-slate-900">
                          14-digit serials · year = 2000 + digits at positions 6–7
                          {bdDetailBasis === 'crm-w'
                            ? ' · filtered by calls_latest_hot.wco = W'
                            : ' · matched Active warranty provision'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void downloadBreakdownDetail()}
                          disabled={bdDetailLoading || exporting || bdDetailTotal <= 0}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] disabled:opacity-50"
                        >
                          <Download
                            className={`h-3.5 w-3.5 ${exporting ? 'animate-pulse' : ''}`}
                          />
                          {exporting ? 'Preparing…' : 'Download Excel'}
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-slate-900 hover:bg-slate-100"
                          onClick={() => {
                            setBdDetailYear(null);
                            setBdDetailMajor('');
                            setBdDetail(null);
                          }}
                          aria-label="Close"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto custom-scrollbar px-2 py-2">
                      {bdDetailLoading ? (
                        <div className="px-2 py-6 text-center text-[14px] text-slate-900">
                          Loading…
                        </div>
                      ) : (
                        <AdminTable className="min-w-full border-collapse text-[14px] [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-[13px] [&_th]:font-semibold [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_td]:text-[14px] [&_td]:text-slate-900">
                          <AdminThead>
                            <tr>
                              <AdminTh>Serial</AdminTh>
                              <AdminTh>YY (pos 6–7)</AdminTh>
                              <AdminTh>TRN</AdminTh>
                              <AdminTh>Party</AdminTh>
                              <AdminTh>Solved</AdminTh>
                              <AdminTh>Status</AdminTh>
                              <AdminTh>Major/Minor</AdminTh>
                            </tr>
                          </AdminThead>
                          <tbody>
                            {(bdDetail?.rows ?? []).map((r, i) => (
                              <AdminTr key={`${r.trn}-${r.serial}-${i}`}>
                                <AdminTd className="font-mono text-[13px]">{r.serial}</AdminTd>
                                <AdminTd className="font-mono">{r.yy}</AdminTd>
                                <AdminTd>{r.trn || '—'}</AdminTd>
                                <AdminTd>{r.partyName || '—'}</AdminTd>
                                <AdminTd>
                                  {r.solvedDay ? formatUiDate(r.solvedDay) : '—'}
                                </AdminTd>
                                <AdminTd>{r.statusBucket || '—'}</AdminTd>
                                <AdminTd>{r.isMajor ? 'Major' : 'Minor'}</AdminTd>
                              </AdminTr>
                            ))}
                          </tbody>
                        </AdminTable>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-2 text-[13px] text-slate-900">
                      {bdDetailLoading ? null : bdDetail ? (
                        <>
                          <span>
                            {bdDetailTotal.toLocaleString('en-IN')} call(s)
                          </span>
                          <label className="text-[13px] text-slate-900">
                            Rows
                            <select
                              value={bdDetailPageSize}
                              onChange={(e) => {
                                setBdDetailPage(1);
                                setBdDetailPageSize(
                                  Number(e.target.value) as (typeof BD_DETAIL_PAGE_SIZES)[number]
                                );
                              }}
                              className="ml-1 h-7 rounded border border-slate-200 px-1.5 text-[13px]"
                              disabled={bdDetailLoading}
                            >
                              {BD_DETAIL_PAGE_SIZES.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <span>
                            Page {bdDetailPage} / {bdDetailTotalPages}
                          </span>
                          <button
                            type="button"
                            className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-1.5 disabled:opacity-40"
                            disabled={bdDetailPage <= 1 || bdDetailLoading}
                            onClick={() => setBdDetailPage((p) => Math.max(1, p - 1))}
                            aria-label="Previous page"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-1.5 disabled:opacity-40"
                            disabled={bdDetailPage >= bdDetailTotalPages || bdDetailLoading}
                            onClick={() => setBdDetailPage((p) => p + 1)}
                            aria-label="Next page"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : null}
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
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px]"
              >
                <Download className="h-3.5 w-3.5" />
                Download template
              </button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px]">
                <Upload className="h-3.5 w-3.5" />
                Import units .xlsx
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => void onUnitsFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <span className="text-[14px] text-slate-900">{unitsImportStatus}</span>
              <span className="text-[13px] text-slate-900">
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
                className="h-8 w-44 rounded border border-slate-200 px-2 text-[14px]"
              />
              <span className="ml-auto flex items-center gap-2 text-[14px] text-slate-900">
                {loading ? 'Loading…' : `${total.toLocaleString('en-IN')} row(s)`}
                {copyTableBtn(unitsGridRef)}
              </span>
            </div>
            <div
              ref={unitsGridRef}
              className="wp-copy-grid min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-bg-canvas custom-scrollbar"
              {...gridSelectHandlers('units')}
            >
              <AdminTable className="w-full min-w-max text-[15px] [&_th]:text-[14px] [&_th]:text-slate-900 [&_td]:text-[15px] [&_td]:text-slate-900">
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
                        className={`font-mono text-[13px] ${cellSelected('units', ri, 0) ? CELL_SEL_CLS : ''}`}
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
                        className={`font-mono text-[13px] ${cellSelected('units', ri, 3) ? CELL_SEL_CLS : ''}`}
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
            <div className="flex shrink-0 items-center justify-between px-1 text-[14px] text-slate-800">
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
            <p className="text-[14px] font-medium text-amber-900">
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
                <div key={k} className="rounded-lg border border-slate-300 bg-white p-3">
                  <div className="text-[13px] font-medium text-slate-800">{k}</div>
                  <div className="text-[18px] font-semibold text-slate-900">{v}</div>
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas">
              <AdminTable className={WP_TABULAR}>
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
                      <AdminTd className="font-semibold">{r.materialGroup}</AdminTd>
                      <AdminTd align="right">{inr(r.units)}</AdminTd>
                      <AdminTd align="right">{inr(r.claims)}</AdminTd>
                      <AdminTd align="right">
                        {r.avgCost != null ? inrMoney(r.avgCost) : '—'}
                      </AdminTd>
                      <AdminTd>{r.flagged ? 'n<30 fallback' : ''}</AdminTd>
                    </AdminTr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-bg-canvas">
              <AdminTable className={WP_TABULAR}>
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
                      <AdminTd className="font-semibold">{r.band}</AdminTd>
                      <AdminTd align="right">{inr(r.exposed)}</AdminTd>
                      <AdminTd align="right">{inr(r.claims)}</AdminTd>
                      <AdminTd align="right">
                        {r.hazard != null ? r.hazard.toFixed(4) : '—'}
                      </AdminTd>
                    </AdminTr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
          </div>
        )}

        {tab === 'forecast' && (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-1">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[14px] text-slate-800">
                Scenario
                <select
                  value={scenario}
                  onChange={(e) =>
                    setScenario(e.target.value as 'base' | 'optimistic' | 'pessimistic')
                  }
                  className="h-8 rounded border border-slate-200 px-2 text-[14px]"
                >
                  <option value="base">Base</option>
                  <option value="optimistic">Optimistic</option>
                  <option value="pessimistic">Pessimistic</option>
                </select>
              </label>
              <span className="rounded bg-slate-100 px-2 py-1 text-[13px] font-medium text-slate-900">
                KPIs & table = {scenario === 'base' ? 'Base' : scenario === 'optimistic' ? 'Optimistic' : 'Pessimistic'}
              </span>
              <button
                type="button"
                onClick={() => void downloadForecast()}
                disabled={exporting}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] disabled:opacity-50"
              >
                <Download className={`h-3.5 w-3.5 ${exporting ? 'animate-pulse' : ''}`} />
                {exporting ? 'Preparing…' : 'Download Excel'}
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
                      <div className="text-[13px] text-slate-900">{k}</div>
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
                <p className="text-[13px] text-slate-900">{forecast.provision.note}</p>
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
                      className={`rounded-lg border p-3 text-left text-[14px] ${
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
                <details className="rounded border border-slate-200 bg-white p-3 text-[14px]">
                  <summary className="cursor-pointer font-semibold">Methodology & limitations</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-800">
                    {forecast.methodology.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-800">
                    {forecast.reconciliations.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="text-[14px] text-slate-900">{loading ? 'Loading…' : 'No forecast'}</p>
            )}
          </div>
        )}

        {tab === 'claims' && (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] text-slate-900">
                Stored claims
                {claimsMeta?.syncedAt
                  ? ` · last sync ${formatUiDate(claimsMeta.syncedAt)} · ${claimsMeta.rowCount.toLocaleString('en-IN')} total`
                  : ' · not synced yet'}
                {' · '}
                {loading ? '…' : `${claimsTotal.toLocaleString('en-IN')} in ${periodYm}`}
              </span>
              {canResyncClaims ? (
                <button
                  type="button"
                  onClick={() => void resyncClaims()}
                  disabled={loading || claimsResyncing}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${claimsResyncing ? 'animate-spin' : ''}`}
                  />
                  {claimsResyncing ? 'Resyncing…' : 'Resync'}
                </button>
              ) : null}
              <input
                value={claimsQDraft}
                onChange={(e) => setClaimsQDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setClaimsQ(claimsQDraft.trim());
                    setClaimsPage(1);
                  }
                }}
                placeholder="Search claim / serial"
                className="ml-auto h-8 w-48 rounded border border-slate-200 px-2 text-[14px]"
                disabled={loading || claimsResyncing}
              />
            </div>
            {!claimsMeta?.syncedAt && !loading ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
                No synced claims yet
                {canResyncClaims
                  ? ' — click Resync to build the table from Call Register, ARCP, and MB51.'
                  : ' — ask a superadmin to run Resync.'}
              </p>
            ) : null}
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>Claim No</AdminTh>
                  <AdminTh>Serial</AdminTh>
                  <AdminTh>Date</AdminTh>
                  <AdminTh>Defect</AdminTh>
                  <AdminTh align="right">Repair Cost</AdminTh>
                  <AdminTh align="right">Traveling Reimbursement</AdminTh>
                  <AdminTh align="right">Spare Parts</AdminTh>
                  <AdminTh align="right">Total</AdminTh>
                  <AdminTh>Match</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {(claims?.rows ?? []).map((c) => (
                  <AdminTr key={c.claimNo || c.id}>
                    <AdminTd>{c.claimNo}</AdminTd>
                    <AdminTd className="font-mono text-[13px]">{c.serialNumber}</AdminTd>
                    <AdminTd>{c.claimDate ? formatUiDate(c.claimDate) : '—'}</AdminTd>
                    <AdminTd className="max-w-[14rem] truncate" title={c.defectDescription}>
                      {c.defectDescription || '—'}
                    </AdminTd>
                    <AdminTd align="right">
                      {c.repairCost != null ? inrMoney(c.repairCost) : '—'}
                    </AdminTd>
                    <AdminTd align="right">
                      {c.travelingReimbursement != null
                        ? inrMoney(c.travelingReimbursement)
                        : '—'}
                    </AdminTd>
                    <AdminTd align="right">
                      {c.sparePartsCost != null ? inrMoney(c.sparePartsCost) : '—'}
                    </AdminTd>
                    <AdminTd align="right">
                      {c.totalCost != null ? inrMoney(c.totalCost) : '—'}
                    </AdminTd>
                    <AdminTd>{c.matchStatus}</AdminTd>
                  </AdminTr>
                ))}
              </tbody>
            </AdminTable>
            <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
              <label className="text-[14px] text-slate-900">
                Rows
                <select
                  value={claimsPageSize}
                  onChange={(e) => {
                    setClaimsPage(1);
                    setClaimsPageSize(
                      Number(e.target.value) as (typeof CLAIMS_PAGE_SIZES)[number]
                    );
                  }}
                  className="ml-1 h-8 rounded border border-slate-200 px-2 text-[14px]"
                  disabled={loading}
                >
                  {CLAIMS_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-[14px] text-slate-900">
                Page {claimsPage} / {claimsTotalPages}
              </span>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[14px] disabled:opacity-40"
                disabled={claimsPage <= 1 || loading}
                onClick={() => setClaimsPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[14px] disabled:opacity-40"
                disabled={claimsPage >= claimsTotalPages || loading}
                onClick={() => setClaimsPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {tab === 'mismatched' && (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] text-slate-900">
                Stored mismatch · Active WP vs CRM WCO=W · {periodYm}
                {mismatch?.meta?.syncedAt
                  ? ` · last sync ${formatUiDate(mismatch.meta.syncedAt)}`
                  : ' · not synced yet'}
                {mismatch
                  ? ` · Warranty Provisioning ${mismatch.wpOnlyCount.toLocaleString('en-IN')} · CRM ${mismatch.crmOnlyCount.toLocaleString('en-IN')}`
                  : ''}
              </span>
              {canResyncClaims ? (
                <button
                  type="button"
                  onClick={() => void resyncClaims()}
                  disabled={loading || claimsResyncing}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${claimsResyncing ? 'animate-spin' : ''}`}
                  />
                  {claimsResyncing ? 'Resyncing…' : 'Resync'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void downloadMismatch()}
                disabled={
                  exporting || loading || claimsResyncing || !mismatch?.meta?.syncedAt
                }
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] disabled:opacity-50"
              >
                <Download className={`h-3.5 w-3.5 ${exporting ? 'animate-pulse' : ''}`} />
                {exporting ? 'Preparing…' : 'Download Excel'}
              </button>
              <label className="ml-auto text-[14px] text-slate-900">
                Only in
                <select
                  value={mismatchOnlyIn}
                  onChange={(e) => {
                    setMismatchPage(1);
                    setMismatchOnlyIn(e.target.value as '' | 'wp' | 'crm');
                  }}
                  className="ml-1 h-8 rounded border border-slate-200 px-2 text-[14px]"
                  disabled={loading || claimsResyncing}
                >
                  <option value="">All</option>
                  <option value="wp">Warranty Provisioning</option>
                  <option value="crm">CRM</option>
                </select>
              </label>
            </div>
            {!mismatch?.meta?.syncedAt && !loading ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
                No synced mismatch yet
                {canResyncClaims
                  ? ' — click Resync to backfill all months at once.'
                  : ' — ask a superadmin to run Resync.'}
              </p>
            ) : null}
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>Only in</AdminTh>
                  <AdminTh>Mfg year</AdminTh>
                  <AdminTh>Serial</AdminTh>
                  <AdminTh>TRN</AdminTh>
                  <AdminTh>Party</AdminTh>
                  <AdminTh>WCO</AdminTh>
                  <AdminTh>Solved</AdminTh>
                  <AdminTh>Status</AdminTh>
                  <AdminTh>Warranty end</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {(mismatch?.rows ?? []).map((r) => (
                  <AdminTr key={`${r.onlyIn}-${r.trn}`}>
                    <AdminTd>{r.onlyIn}</AdminTd>
                    <AdminTd>{r.mfgYear || '—'}</AdminTd>
                    <AdminTd className="font-mono text-[13px]">{r.serial}</AdminTd>
                    <AdminTd className="font-mono text-[13px]">{r.trn}</AdminTd>
                    <AdminTd className="max-w-[12rem] truncate" title={r.partyName}>
                      {r.partyName || '—'}
                    </AdminTd>
                    <AdminTd>{r.wco || '—'}</AdminTd>
                    <AdminTd>{r.solvedDay ? formatUiDate(r.solvedDay) : '—'}</AdminTd>
                    <AdminTd>{r.statusBucket || '—'}</AdminTd>
                    <AdminTd>
                      {r.warrantyEnd ? formatUiDate(r.warrantyEnd) : '—'}
                    </AdminTd>
                  </AdminTr>
                ))}
              </tbody>
            </AdminTable>
            {!loading && !(mismatch?.rows.length) ? (
              <p className="text-[14px] text-slate-900">No mismatched calls for this filter.</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
              <label className="text-[14px] text-slate-900">
                Rows
                <select
                  value={mismatchPageSize}
                  onChange={(e) => {
                    setMismatchPage(1);
                    setMismatchPageSize(
                      Number(e.target.value) as (typeof MISMATCH_PAGE_SIZES)[number]
                    );
                  }}
                  className="ml-1 h-8 rounded border border-slate-200 px-2 text-[14px]"
                  disabled={loading}
                >
                  {MISMATCH_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-[14px] text-slate-900">
                {loading
                  ? '…'
                  : `${mismatchTotal.toLocaleString('en-IN')} rows · Page ${mismatchPage} / ${mismatchTotalPages}`}
              </span>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[14px] disabled:opacity-40"
                disabled={mismatchPage <= 1 || loading}
                onClick={() => setMismatchPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[14px] disabled:opacity-40"
                disabled={mismatchPage >= mismatchTotalPages || loading}
                onClick={() => setMismatchPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {tab === 'assumptions' && assumptions && (
          <div className="max-w-xl space-y-3 overflow-auto p-2 text-[14px]">
            {(
              [
                ['inflationPct', 'Annual inflation %', 'pct'],
                ['discountPct', 'Discount rate %', 'pct'],
                ['optimisticProbMult', 'Optimistic probability %', 'multPct'],
                ['optimisticCostMult', 'Optimistic cost %', 'multPct'],
                ['pessimisticProbMult', 'Pessimistic probability %', 'multPct'],
                ['pessimisticCostMult', 'Pessimistic cost %', 'multPct'],
                ['existingProvision', 'Existing provision balance', 'money'],
              ] as const
            ).map(([key, label, kind]) => (
              <label key={key} className="flex items-center justify-between gap-3">
                <span>{label}</span>
                <input
                  type="number"
                  step={kind === 'multPct' ? '1' : '0.01'}
                  value={
                    kind === 'multPct'
                      ? Math.round(Number(assumptions[key]) * 1000) / 10
                      : assumptions[key]
                  }
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    setAssumptions({
                      ...assumptions,
                      [key]: kind === 'multPct' ? raw / 100 : raw,
                    });
                  }}
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
