'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import type {
  Mb51AgingMovement,
  Mb51AgingImportMeta,
  Mb51AgingAggRow,
  Mb51AgingResult,
  Mb51AgingReportParams,
  Mb51AgingSummary,
  Mb51AgingThinRow,
} from '@/modules/mb51-aging/types';
import {
  fetchMb51AggPage,
  fetchMb51Facets,
  fetchMb51Meta,
  fetchMb51Summary,
  postMb51Detail,
  postMb51Report,
} from '@/modules/mb51-aging/api-client';
import { canPostFilterMb51Agg } from '@/modules/mb51-aging/can-post-filter';
import { saveMb51AgingRows } from '@/modules/mb51-aging/save-client';
import {
  downloadMb51TemplateCsv,
  formatMb51ParseFailure,
  listLoadedSheetNames,
  parseMb51Workbook,
} from '@/modules/mb51-aging/parse-workbook';
import {
  MB51_XLSX_ZIP_FALLBACK_BYTES,
  parseMb51Upload,
  parseMb51XlsxZip,
} from '@/modules/mb51-aging/parse-xlsx-zip';
import {
  BUCKETS,
  DEFAULT_DEFECTIVE_MATERIALS,
  bucketOf,
} from '@/modules/mb51-aging/fifo';

const DAY = 86400000;
const EPOCH_OFFSET = 25569;

const dateToSerial = (s: string): number | null => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d) / DAY + EPOCH_OFFSET;
};

const serialToISO = (n: number): string => {
  try {
    return new Date(Math.round((n - EPOCH_OFFSET) * DAY)).toISOString().slice(0, 10);
  } catch {
    return '';
  }
};

const serialToDMY = (n: number): string => {
  const i = serialToISO(n);
  if (!i || i.length < 10) return '–';
  return `${i.slice(8, 10)}.${i.slice(5, 7)}.${i.slice(0, 4)}`;
};

/** Table / modal — whole numbers. */
const fmtQty = (v: number): string => {
  if (v === 0 || Math.abs(v) < 1e-9) return '–';
  const n = Math.round(v);
  if (n === 0) return '–';
  const s = Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
};

/** KPI cards — keep decimals (up to 3). */
const fmtQtyDec = (v: number): string => {
  if (v === 0 || Math.abs(v) < 1e-9) return '–';
  const s = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return v < 0 ? `(${s})` : s;
};

const MB51_FILE_RE = /\.(xlsx|xlsm|xls|csv)$/i;

function pickMb51Files(list: FileList | File[] | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => MB51_FILE_RE.test(f.name));
}

const HEAD: Record<string, [string, string][]> = {
  vendor: [
    ['a', 'Vendor code'],
    ['b', 'Vendor name'],
    ['u', 'UoM'],
  ],
  group: [
    ['c', 'Material group'],
    ['u', 'UoM'],
  ],
  mat: [
    ['d', 'Material'],
    ['e', 'Material description'],
    ['c', 'Material group'],
    ['u', 'UoM'],
  ],
  vm: [
    ['a', 'Vendor code'],
    ['b', 'Vendor name'],
    ['d', 'Material'],
    ['e', 'Material description'],
    ['c', 'Material group'],
    ['u', 'UoM'],
  ],
};

/** Column width class — codes stay tight; name/description take leftover. */
function headColClass(k: string): string | undefined {
  if (k === 'a' || k === 'd') return 'code';
  if (k === 'b' || k === 'e') return 'clip';
  if (k === 'c') return 'grp';
  if (k === 'u') return 'uom';
  return undefined;
}

type OptionItem = { id: string; text: string; lc: string };

function MultiSelectDropdown({
  label,
  items,
  selected,
  onChange,
  emptyText,
  selectedOnlyLabel = 'Selected only',
  totalCount,
  loadOptions,
  onDiscover,
}: {
  label: string;
  items: OptionItem[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  /** Shown when nothing is selected (default: All {label}). */
  emptyText?: string;
  /** Toggle button label to list only checked items (e.g. "Excluded only"). */
  selectedOnlyLabel?: string;
  /** True DISTINCT total — list may be capped so do not use items.length. */
  totalCount?: number;
  /** Server search beyond the capped local list. */
  loadOptions?: (q: string) => Promise<OptionItem[]>;
  /** Keep remote picks in parent facet state so labels survive close. */
  onDiscover?: (item: OptionItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [remote, setRemote] = useState<OptionItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const searchGen = useRef(0);
  const loadRef = useRef(loadOptions);
  loadRef.current = loadOptions;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // If selection cleared while viewing selected-only, fall back to full list
  useEffect(() => {
    if (selectedOnly && selected.size === 0) setSelectedOnly(false);
  }, [selected, selectedOnly]);

  // Debounced server search when typing past the 2000-cap local list
  useEffect(() => {
    if (!loadRef.current || selectedOnly) {
      setRemote(null);
      setSearching(false);
      return;
    }
    const q = query.trim();
    if (!q) {
      setRemote(null);
      setSearching(false);
      return;
    }
    const gen = ++searchGen.current;
    setSearching(true);
    const t = window.setTimeout(() => {
      void loadRef
        .current?.(q)
        .then((hits) => {
          if (gen !== searchGen.current) return;
          setRemote(hits);
        })
        .catch(() => {
          if (gen !== searchGen.current) return;
          setRemote([]);
        })
        .finally(() => {
          if (gen === searchGen.current) setSearching(false);
        });
    }, 280);
    return () => window.clearTimeout(t);
  }, [query, selectedOnly]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dedupe = (list: OptionItem[]) => {
      const byId = new Map<string, OptionItem>();
      for (const i of list) if (!byId.has(i.id)) byId.set(i.id, i);
      return [...byId.values()];
    };
    if (selectedOnly) {
      const pool = [...items, ...(remote ?? [])];
      const byId = new Map(pool.map((i) => [i.id, i]));
      return [...selected]
        .map((id) => byId.get(id) ?? { id, text: id, lc: id.toLowerCase() })
        .filter((i) => !q || i.lc.includes(q));
    }
    if (remote) return dedupe(remote);
    if (!q) return dedupe(items);
    return dedupe(items.filter((i) => i.lc.includes(q)));
  }, [items, query, selectedOnly, selected, remote]);

  const lim = 400;
  const part = shown.slice(0, lim);

  const buttonText = useMemo(() => {
    const n = selected.size;
    const allN = totalCount ?? items.length;
    if (n === 0) return emptyText ?? `All ${label} (${allN.toLocaleString('en-IN')})`;
    if (n === 1) {
      const match =
        items.find((i) => selected.has(i.id)) ??
        remote?.find((i) => selected.has(i.id));
      return match ? match.text : '1 selected';
    }
    return `${n} selected`;
  }, [selected, label, items, emptyText, totalCount, remote]);

  return (
    <div className={`ms ${open ? 'open' : ''}`} ref={popRef}>
      <div className="ms-btn" tabIndex={0} onClick={() => setOpen((o) => !o)}>
        <span className="t">{buttonText}</span>
      </div>
      {open && (
        <div className="ms-pop">
          <div className="ms-top">
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className={selectedOnly ? 'on' : undefined}
              disabled={selected.size === 0}
              title={
                selected.size === 0
                  ? 'Select items first'
                  : selectedOnly
                    ? 'Show full list'
                    : `Show only ${selectedOnlyLabel.toLowerCase()}`
              }
              onClick={() => setSelectedOnly((v) => !v)}
            >
              {selectedOnly ? 'Show all' : selectedOnlyLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = new Set(selected);
                shown.forEach((i) => {
                  next.add(i.id);
                  onDiscover?.(i);
                });
                onChange(next);
              }}
            >
              All shown
            </button>
            <button type="button" onClick={() => onChange(new Set())}>
              Clear
            </button>
          </div>
          <div className="ms-list">
            {part.length > 0 ? (
              part.map((i) => (
                <label key={i.id} className="ms-item">
                  <input
                    type="checkbox"
                    checked={selected.has(i.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) {
                        next.add(i.id);
                        onDiscover?.(i);
                      } else next.delete(i.id);
                      onChange(next);
                    }}
                  />
                  <span>{i.text}</span>
                </label>
              ))
            ) : (
              <div className="empty">
                {searching
                  ? 'Searching…'
                  : selectedOnly
                    ? 'No excluded materials'
                    : 'No match'}
              </div>
            )}
          </div>
          <div className="ms-foot">
            {selectedOnly
              ? `${shown.length} excluded`
              : remote
                ? `${shown.length} match${shown.length === 1 ? '' : 'es'}${searching ? '…' : ''}`
                : `${shown.length} of ${(totalCount ?? items.length).toLocaleString('en-IN')} shown`}
            {shown.length > lim ? ` (first ${lim} – refine search)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function thinToAgg(r: Mb51AgingThinRow): Mb51AgingAggRow {
  return {
    a: r.a,
    b: r.b,
    c: r.c,
    d: r.d,
    e: r.e,
    u: r.u,
    bk: r.bk,
    total: r.total,
    full: r.full,
    n: r.n,
    det: BUCKETS.map(() => []),
    fg: [],
    groupKey: r.groupKey,
  };
}

function summaryToResult(
  s: Mb51AgingSummary,
  rows: Mb51AgingThinRow[]
): Mb51AgingResult {
  return {
    rows: rows.map(thinToAgg),
    tot: s.tot,
    gb: s.gb,
    basis: s.basis,
    from: s.from,
    to: s.to,
    maxD: s.maxD,
    fullTot: s.fullTot,
    used: s.used,
    negMat: s.negMat,
    negQty: s.negQty,
    plugged: s.plugged,
    plugQty: s.plugQty,
    stockMat: s.stockMat,
  };
}

const MB51_ACTIVE_IMPORT_KEY = 'mb51.activeImportId';

function readStoredImportId(): string | null {
  try {
    return localStorage.getItem(MB51_ACTIVE_IMPORT_KEY);
  } catch {
    return null;
  }
}

function writeStoredImportId(id: string | null) {
  try {
    if (id) localStorage.setItem(MB51_ACTIVE_IMPORT_KEY, id);
    else localStorage.removeItem(MB51_ACTIVE_IMPORT_KEY);
  } catch {
    /* ignore */
  }
}

export default function Mb51AgingPageClient() {
  const [latestImport, setLatestImport] = useState<Mb51AgingImportMeta | null>(null);
  const [imports, setImports] = useState<Mb51AgingImportMeta[]>([]);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  /** Escape hatch only — default grows the one overall dataset / snapshot. */
  const [forceNewImport, setForceNewImport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState<string>('Loading MB51 Aging Report from portal database…');
  const [isErrMsg, setIsErrMsg] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [wbInstance, setWbInstance] = useState<XLSX.WorkBook | null>(null);
  const [availableSheets, setAvailableSheets] = useState<{ name: string; rowCount: number }[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());

  // Default group by Vendor + Material
  const [groupBy, setGroupBy] = useState<'mat' | 'vendor' | 'group' | 'vm'>('vm');

  // Filters state
  const [basisDate, setBasisDate] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [minDateLimit, setMinDateLimit] = useState<string>('');
  const [maxDateLimit, setMaxDateLimit] = useState<string>('');
  const [, setMaxPostingSerial] = useState(0);
  /** Any materials the user wants dropped from aging (not limited to the known 6). */
  const [excludedMaterials, setExcludedMaterials] = useState<Set<string>>(new Set());
  const [sheetLabel, setSheetLabel] = useState('');
  const [uomInfo, setUomInfo] = useState('');

  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [selectedPlants, setSelectedPlants] = useState<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('total');
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);
  const [paramHash, setParamHash] = useState('default');
  /** Params baked into the loaded snapshot (for filter-vs-recompute decide). */
  const [snapshotParams, setSnapshotParams] = useState<Mb51AgingReportParams | null>(null);
  /** Dim + exclude filters applied on top of the current snapshot (no FIFO). */
  const [aggFilters, setAggFilters] = useState<{
    vendors: string[];
    groups: string[];
    materials: string[];
    excludedMaterials: string[];
  }>({ vendors: [], groups: [], materials: [], excludedMaterials: [] });
  const [aggTotal, setAggTotal] = useState(0);
  const [summary, setSummary] = useState<Mb51AgingSummary | null>(null);
  const [thinRows, setThinRows] = useState<Mb51AgingThinRow[]>([]);
  const [facetVendors, setFacetVendors] = useState<OptionItem[]>([]);
  const [facetGroups, setFacetGroups] = useState<OptionItem[]>([]);
  const [facetMaterials, setFacetMaterials] = useState<OptionItem[]>([]);
  const [facetPlants, setFacetPlants] = useState<OptionItem[]>([]);
  const [facetTotals, setFacetTotals] = useState({
    vendors: 0,
    materials: 0,
    groups: 0,
    plants: 0,
    movements: 0,
  });

  // Result state (summary + current thin page mapped for existing UI)
  const reportResult = useMemo(
    () => (summary ? summaryToResult(summary, thinRows) : null),
    [summary, thinRows]
  );

  // Detail Drill-down Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalBucketIdx, setModalBucketIdx] = useState<number>(-1);
  const [modalLines, setModalLines] = useState<[Mb51AgingMovement, number, number][]>([]);
  const [modalNet, setModalNet] = useState<{
    pos: number;
    neg: number;
    net: number;
    n: number;
    r: Mb51AgingMovement;
  }[] | null>(null);

  const selectImport = useCallback((id: string | null) => {
    setActiveImportId(id);
    writeStoredImportId(id);
  }, []);

  const aggFiltersRef = useRef(aggFilters);
  aggFiltersRef.current = aggFilters;
  /** When Generate already loaded page 1, skip the effect's immediate re-fetch. */
  const skipAggEffectRef = useRef(false);

  const loadAggPage = useCallback(
    async (
      hash: string,
      pageNum: number,
      q: string,
      sort: string,
      dir: number,
      importId?: string | null,
      filters?: {
        vendors: string[];
        groups: string[];
        materials: string[];
        excludedMaterials: string[];
      },
      withSummary = false
    ) => {
      const f = filters ?? aggFiltersRef.current;
      const agg = await fetchMb51AggPage({
        paramHash: hash,
        importId: importId ?? activeImportId,
        page: pageNum,
        pageSize: PAGE_SIZE,
        q,
        sort: sort || 'total',
        sortDir: dir,
        vendors: f.vendors,
        groups: f.groups,
        materials: f.materials,
        excludedMaterials: f.excludedMaterials,
        withSummary,
      });
      setThinRows(agg.rows);
      setAggTotal(agg.total);
      // Don't setPage here — caller/effect owns page; setting it retriggers loads.
      if (agg.summary) setSummary(agg.summary);
      return agg;
    },
    [activeImportId]
  );

  const discoverFacet = useCallback(
    (kind: 'vendors' | 'groups' | 'materials' | 'plants', item: OptionItem) => {
      const setter =
        kind === 'vendors'
          ? setFacetVendors
          : kind === 'groups'
            ? setFacetGroups
            : kind === 'plants'
              ? setFacetPlants
              : setFacetMaterials;
      setter((prev) => {
        const i = prev.findIndex((x) => x.id === item.id);
        if (i < 0) return [...prev, item];
        // Prefer richer "code - name" label from search/master join
        if (prev[i].text === item.text) return prev;
        const next = prev.slice();
        next[i] = item;
        return next;
      });
    },
    []
  );

  const searchFacet = useCallback(
    (kind: 'vendors' | 'groups' | 'materials' | 'plants') =>
      async (q: string): Promise<OptionItem[]> => {
        const facets = await fetchMb51Facets(q, activeImportId, {
          fields: [kind],
          limit: 200,
        });
        const raw =
          kind === 'vendors'
            ? facets.vendors
            : kind === 'groups'
              ? facets.groups
              : kind === 'plants'
                ? facets.plants
                : facets.materials;
        return raw.map((x) => ({ id: x.id, text: x.text, lc: x.text.toLowerCase() }));
      },
    [activeImportId]
  );

  const applyMetaDates = useCallback((imp: Mb51AgingImportMeta) => {
    const mn = imp.minPostingSerial ?? 0;
    const mx = imp.maxPostingSerial ?? 0;
    const isoMn = serialToISO(mn);
    const isoMx = serialToISO(mx);
    setDateFrom(isoMn);
    setDateTo(isoMx);
    setMinDateLimit(isoMn);
    setMaxDateLimit(isoMx);
    setMaxPostingSerial(mx);
    if (isoMx) setBasisDate(isoMx);
  }, []);

  const loadSnapshotView = useCallback(
    async (hash = 'default', importId?: string | null) => {
      const id = importId ?? activeImportId ?? readStoredImportId();
      const [sumRes, facets] = await Promise.all([
        fetchMb51Summary(hash, id),
        fetchMb51Facets('', id),
      ]);
      if (sumRes.imports) setImports(sumRes.imports);
      if (!sumRes.latestImport) {
        setShowUpload(true);
        setLoadMsg('No saved data found in database. Please upload your MB51 export file.');
        return false;
      }
      selectImport(sumRes.latestImport.id);
      setLatestImport(sumRes.latestImport);
      applyMetaDates(sumRes.latestImport);
      setFacetVendors(
        facets.vendors.map((x) => ({ id: x.id, text: x.text, lc: x.text.toLowerCase() }))
      );
      setFacetGroups(
        facets.groups.map((x) => ({ id: x.id, text: x.text, lc: x.text.toLowerCase() }))
      );
      setFacetMaterials(
        facets.materials.map((x) => ({ id: x.id, text: x.text, lc: x.text.toLowerCase() }))
      );
      setFacetPlants(
        facets.plants.map((x) => ({ id: x.id, text: x.text, lc: x.text.toLowerCase() }))
      );
      if (facets.totals) setFacetTotals(facets.totals);

      // UI exclude chips: snap bake if present, else known defectives present in data.
      const uiExcludes = sumRes.params?.excludedMaterials?.length
        ? [...sumRes.params.excludedMaterials]
        : DEFAULT_DEFECTIVE_MATERIALS.filter((m) =>
            facets.materials.some((f) => f.id === m)
          );
      setExcludedMaterials(new Set(uiExcludes));

      if (!sumRes.summary) {
        setSummary(null);
        setThinRows([]);
        setAggTotal(0);
        setLoadMsg(
          sumRes.latestImport.snapshotReady === false
            ? 'Aging snapshot is still building — click Generate, or wait and refresh.'
            : 'No aging snapshot yet — click Generate.'
        );
        setShowUpload(false);
        return true;
      }

      setParamHash(sumRes.summary.paramHash);
      setGroupBy(sumRes.summary.gb);
      // Sync date pickers to the snapshot that produced these KPIs
      if (sumRes.params) {
        const b = serialToISO(sumRes.params.basis);
        const f = serialToISO(sumRes.params.from);
        const t = serialToISO(sumRes.params.to);
        if (b) setBasisDate(b);
        if (f) setDateFrom(f);
        if (t) setDateTo(t);
      }
      if (sumRes.summary.facetTotals) setFacetTotals(sumRes.summary.facetTotals);

      // Post-filter excludes only when the snap did not bake them (else double-filter is a no-op
      // for those codes, but we must still load page 1 — skipping left Result rows at 0).
      const snapBakedExcludes = !!(sumRes.params?.excludedMaterials?.length);
      const filters = {
        vendors: [] as string[],
        groups: [] as string[],
        materials: [] as string[],
        excludedMaterials: snapBakedExcludes ? [] : uiExcludes,
      };
      setSnapshotParams(sumRes.params);
      setAggFilters(filters);
      setPage(1);
      setSearchQuery('');
      skipAggEffectRef.current = true;
      const rolled = await fetchMb51AggPage({
        paramHash: sumRes.summary.paramHash,
        importId: id,
        page: 1,
        pageSize: PAGE_SIZE,
        sort: 'total',
        sortDir: -1,
        excludedMaterials: filters.excludedMaterials,
        withSummary: filters.excludedMaterials.length > 0,
      });
      setThinRows(rolled.rows);
      setAggTotal(rolled.total);
      setSummary(rolled.summary ?? sumRes.summary);
      setShowUpload(false);
      setLoadMsg('');
      return true;
    },
    [applyMetaDates, activeImportId, selectImport]
  );

  // Fast path: meta + summary KPIs + first agg page (no movement dump)
  useEffect(() => {
    let active = true;
    async function loadSavedData() {
      try {
        setLoading(true);
        setLoadMsg('Loading…');
        const preferred = readStoredImportId();
        const meta = await fetchMb51Meta(preferred);
        if (!active) return;
        setImports(meta.imports ?? []);
        if (!meta.latestImport) {
          setLoadMsg('No saved data found in database. Please upload your MB51 export file.');
          setShowUpload(true);
          return;
        }
        selectImport(meta.latestImport.id);
        setLatestImport(meta.latestImport);
        applyMetaDates(meta.latestImport);
        setIsErrMsg(false);
        await loadSnapshotView('default', meta.latestImport.id);
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Failed to query database';
        setLoadMsg(msg);
        setIsErrMsg(true);
        setShowUpload(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadSavedData();
    return () => {
      active = false;
    };
  }, []);

  const vendorOptions = facetVendors;
  const groupOptions = facetGroups;
  const plantOptions = facetPlants;
  const excludeMatOptions = facetMaterials;
  const matOptions = useMemo(
    () => facetMaterials.filter((i) => !excludedMaterials.has(i.id)),
    [facetMaterials, excludedMaterials]
  );

  // Generate: filter existing snapshot when possible; FIFO only when params need it
  const handleRun = useCallback(async () => {
    if (!basisDate) {
      alert('Please select an aging basis date.');
      return;
    }
    const basis = dateToSerial(basisDate);
    if (basis == null) {
      alert('Please select an aging basis date.');
      return;
    }
    const nextParams: Mb51AgingReportParams = {
      basis,
      from: dateToSerial(dateFrom) ?? -1e9,
      to: dateToSerial(dateTo) ?? 1e9,
      groupBy,
      plants: [...selectedPlants],
      vendors: [...selectedVendors],
      groups: [...selectedGroups],
      materials: [...selectedMaterials],
      excludedMaterials: [...excludedMaterials],
    };
    try {
      setLoading(true);
      setIsErrMsg(false);

      const filters = {
        vendors: nextParams.vendors,
        groups: nextParams.groups,
        materials: nextParams.materials,
        excludedMaterials: nextParams.excludedMaterials,
      };
      const hasPostFilter =
        filters.vendors.length +
          filters.groups.length +
          filters.materials.length +
          filters.excludedMaterials.length >
        0;

      // Fast path: same FIFO basis as loaded snapshot → filter agg rows only
      if (snapshotParams && canPostFilterMb51Agg(snapshotParams, nextParams)) {
        setLoadMsg('Filtering…');
        if (!hasPostFilter) {
          const sumRes = await fetchMb51Summary(paramHash, activeImportId);
          if (sumRes.summary) setSummary(sumRes.summary);
        }
        skipAggEffectRef.current = true;
        setAggFilters(filters);
        setPage(1);
        await loadAggPage(
          paramHash,
          1,
          searchQuery,
          sortKey || 'total',
          sortDir,
          activeImportId,
          filters,
          hasPostFilter
        );
        setLoadMsg('');
        setShowUpload(false);
        return;
      }

      // Slow path: rematerialize a reusable base (no dim/exclude bake) then post-filter.
      // Dim filters + excludes stay out of FIFO so later Generate clicks stay fast.
      setLoadMsg('Computing aging…');
      const baseParams: Mb51AgingReportParams = {
        basis: nextParams.basis,
        from: nextParams.from,
        to: nextParams.to,
        groupBy: nextParams.groupBy,
        plants: nextParams.plants,
        vendors: [],
        groups: [],
        materials: [],
        excludedMaterials: [],
      };
      const rebuilt = await postMb51Report(baseParams, activeImportId);
      skipAggEffectRef.current = true;
      setParamHash(rebuilt.paramHash);
      setSnapshotParams(baseParams);
      setAggFilters(filters);
      setPage(1);
      await loadAggPage(
        rebuilt.paramHash,
        1,
        searchQuery,
        sortKey || 'total',
        sortDir,
        activeImportId,
        filters,
        hasPostFilter
      );
      if (!hasPostFilter) setSummary(rebuilt.summary);
      setLoadMsg('');
      setShowUpload(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Generate failed';
      setLoadMsg(msg);
      setIsErrMsg(true);
    } finally {
      setLoading(false);
    }
  }, [
    basisDate,
    dateFrom,
    dateTo,
    groupBy,
    selectedPlants,
    selectedVendors,
    selectedGroups,
    selectedMaterials,
    excludedMaterials,
    searchQuery,
    sortKey,
    sortDir,
    loadAggPage,
    activeImportId,
    snapshotParams,
    paramHash,
  ]);

  const applyUomInfo = useCallback(
    (
      out: Mb51AgingMovement[],
      sheetNames: string[],
      qtyCol: string,
      uomCol: string,
      uomSeen: Map<string, number>
    ) => {
      const mu = new Map<string, Set<string>>();
      for (const r of out) {
        let s = mu.get(r.m);
        if (!s) {
          s = new Set();
          mu.set(r.m, s);
        }
        s.add(r.u);
      }
      const multi = [...mu.entries()]
        .filter(([, s]) => s.size > 1)
        .map(([m, s]) => `${m} (${[...s].join('/')})`);
      setUomInfo(
        `Quantity taken from column "${qtyCol}" and unit from "${uomCol}" (no conversion). Units in data: ${[
          ...uomSeen.entries(),
        ]
          .map(([u, n]) => `${u || '(blank)'} ${n.toLocaleString('en-IN')}`)
          .join(', ')}.${
          multi.length
            ? ` Materials with more than one unit (reported separately): ${multi.join(', ')}.`
            : ''
        }`
      );
      setSheetLabel(sheetNames.join(', '));
    },
    []
  );

  // Save parsed data to backend (chunked — large MB51 JSON cannot go in one POST)
  const saveRowsToDatabase = useCallback(
    async (
      fileName: string,
      parsedRows: Mb51AgingMovement[],
      opts?: {
        appendToImportId?: string | null;
        manageLoading?: boolean;
        /** Multi-file path forces overall merge (false). */
        forceNewImport?: boolean;
      }
    ) => {
      const manageLoading = opts?.manageLoading !== false;
      try {
        if (manageLoading) {
          setLoading(true);
          setIsErrMsg(false);
        }
        const meta = await saveMb51AgingRows(fileName, parsedRows, {
          appendToImportId: opts?.appendToImportId,
          forceNewImport: opts?.forceNewImport ?? forceNewImport,
          onProgress: (saved, total) => {
            setLoadMsg(
              `Saving to database… ${saved.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')} rows`
            );
          },
        });
        selectImport(meta.id);
        setLatestImport(meta);
        setLoadMsg('Building aging snapshot…');
        await loadSnapshotView('default', meta.id);
        const listed = await fetchMb51Meta(meta.id);
        setImports(listed.imports ?? []);
        setLoadMsg('');
        setIsErrMsg(false);
        return meta;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Database save failed';
        console.error('[MB51 Save Error]', err);
        setLoadMsg(
          `Parsed file locally, but database save failed — data will be lost on reload. ${msg}`
        );
        setIsErrMsg(true);
        throw err;
      } finally {
        if (manageLoading) setLoading(false);
      }
    },
    [forceNewImport, loadSnapshotView, selectImport]
  );

  // Build movement records from sheets
  const processSheets = useCallback(
    (wb: XLSX.WorkBook, sheetNames: string[], fileName: string) => {
      setLoadMsg('Processing sheet data…');
      setIsErrMsg(false);

      setTimeout(() => {
        try {
          const parsed = parseMb51Workbook(wb, sheetNames);
          if (!parsed.rows.length) {
            setLoadMsg(formatMb51ParseFailure(parsed));
            setIsErrMsg(true);
            return;
          }

          applyUomInfo(parsed.rows, sheetNames, parsed.qtyCol, parsed.uomCol, parsed.uomSeen);
          setAvailableSheets([]);
          setWbInstance(null);
          void saveRowsToDatabase(fileName, parsed.rows).then(() => setShowUpload(false));
        } catch (err: unknown) {
          console.error(err);
          const msg = err instanceof Error ? err.message : 'Error processing sheets';
          setLoadMsg(`Processing failed: ${msg}`);
          setIsErrMsg(true);
        }
      }, 30);
    },
    [applyUomInfo, saveRowsToDatabase]
  );

  /** Several files at once: each becomes its own import (or all append when checkbox is on). */
  const importManyFiles = useCallback(
    async (files: File[]) => {
      setLoading(true);
      setIsErrMsg(false);
      setAvailableSheets([]);
      setWbInstance(null);
      // Multi-file always grows the one overall import (one FIFO snapshot).
      let appendId: string | null = activeImportId;
      const errors: string[] = [];
      let lastId: string | null = null;
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setLoadMsg(`Reading ${i + 1}/${files.length}: ${f.name}…`);
          const buf = await f.arrayBuffer();
          const parsed = await parseMb51Upload(buf, {
            fileName: f.name,
            fileSize: f.size,
            onProgress: (m) => setLoadMsg(`${i + 1}/${files.length}: ${m}`),
          });
          if (!parsed.rows.length) {
            errors.push(`${f.name}: ${formatMb51ParseFailure(parsed)}`);
            continue;
          }
          applyUomInfo(
            parsed.rows,
            [f.name],
            parsed.qtyCol,
            parsed.uomCol,
            parsed.uomSeen
          );
          setLoadMsg(
            `Saving ${i + 1}/${files.length}: ${f.name} (${parsed.rows.length.toLocaleString('en-IN')} rows)…`
          );
          const meta = await saveRowsToDatabase(f.name, parsed.rows, {
            appendToImportId: appendId,
            manageLoading: false,
            forceNewImport: false,
          });
          lastId = meta.id;
          appendId = meta.id;
        }
        if (!lastId) {
          setLoadMsg(errors.join('; ') || 'No files imported');
          setIsErrMsg(true);
          return;
        }
        setShowUpload(false);
        setLoadMsg(
          errors.length
            ? `Imported ${files.length - errors.length} of ${files.length} files. ${errors.join('; ')}`
            : `Imported ${files.length} file${files.length === 1 ? '' : 's'}.`
        );
        setIsErrMsg(errors.length > 0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Multi-file import failed';
        setLoadMsg(msg);
        setIsErrMsg(true);
      } finally {
        setLoading(false);
      }
    },
    [activeImportId, applyUomInfo, saveRowsToDatabase]
  );

  // File loading — single file keeps sheet picker; multi skips straight to import
  const handleFile = (f: File) => {
    setLoadMsg(`Reading ${f.name} … please wait`);
    setIsErrMsg(false);
    setAvailableSheets([]);

    const lower = f.name.toLowerCase();
    const hugeOoxml =
      (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) &&
      f.size >= MB51_XLSX_ZIP_FALLBACK_BYTES;

    void (async () => {
      const buf = await f.arrayBuffer();
      if (hugeOoxml) {
        setLoading(true);
        try {
          const parsed = await parseMb51XlsxZip(buf, { onProgress: setLoadMsg });
          if (!parsed.rows.length) {
            setLoadMsg(formatMb51ParseFailure(parsed));
            setIsErrMsg(true);
            return;
          }
          applyUomInfo(parsed.rows, [f.name], parsed.qtyCol, parsed.uomCol, parsed.uomSeen);
          setAvailableSheets([]);
          setWbInstance(null);
          await saveRowsToDatabase(f.name, parsed.rows);
          setShowUpload(false);
        } finally {
          setLoading(false);
        }
        return;
      }

      const wb = XLSX.read(new Uint8Array(buf), {
        type: 'array',
        cellDates: true,
        raw: true,
      });
      setWbInstance(wb);
      const names = listLoadedSheetNames(wb);
      if (names.length > 1) {
        const list = names.map((n) => {
          const ws = wb.Sheets[n] as unknown as { '!data'?: unknown[] } | unknown[];
          const rowCount = Array.isArray(ws)
            ? ws.length
            : ws?.['!data']
              ? ws['!data'].length
              : 0;
          return { name: n, rowCount };
        });
        setAvailableSheets(list);
        setSelectedSheets(new Set(names));
        setLoadMsg(
          `Workbook has ${names.length} sheets – tick the sheets that hold movement data, then click Load.`
        );
        return;
      }
      if (names.length === 1) {
        processSheets(wb, names, f.name);
        return;
      }

      setLoading(true);
      try {
        const parsed = await parseMb51Upload(buf, {
          fileName: f.name,
          fileSize: f.size,
          onProgress: setLoadMsg,
        });
        if (!parsed.rows.length) {
          setLoadMsg(formatMb51ParseFailure(parsed));
          setIsErrMsg(true);
          return;
        }
        applyUomInfo(parsed.rows, [f.name], parsed.qtyCol, parsed.uomCol, parsed.uomSeen);
        setAvailableSheets([]);
        setWbInstance(null);
        await saveRowsToDatabase(f.name, parsed.rows);
        setShowUpload(false);
      } finally {
        setLoading(false);
      }
    })().catch((err: unknown) => {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Failed to parse file';
      setLoadMsg(`Failed to parse: ${msg}`);
      setIsErrMsg(true);
      setLoading(false);
    });
  };

  const handleFiles = (list: FileList | File[] | null) => {
    const files = pickMb51Files(list);
    if (!files.length) {
      setLoadMsg('Select .xlsx / .xls / .csv MB51 export files.');
      setIsErrMsg(true);
      return;
    }
    if (files.length === 1) handleFile(files[0]);
    else void importManyFiles(files);
  };

  const handleResetFilters = () => {
    const codes = new Set(facetMaterials.map((m) => m.id));
    const seedExcluded = new Set(
      DEFAULT_DEFECTIVE_MATERIALS.filter((m) => codes.has(m))
    );
    setSelectedVendors(new Set());
    setSelectedGroups(new Set());
    setSelectedMaterials(new Set());
    setSelectedPlants(new Set());
    setExcludedMaterials(seedExcluded);
    setGroupBy('vm');
    setSearchQuery('');
    if (minDateLimit) setDateFrom(minDateLimit);
    if (maxDateLimit) {
      setDateTo(maxDateLimit);
      setBasisDate(maxDateLimit);
    }
    void loadSnapshotView('default');
  };

  // Main Excel Export (pull all thin pages for current snapshot/filters)
  const exportXls = async () => {
    if (!reportResult || !paramHash) return;
    const R = reportResult;
    const cols = HEAD[R.gb] || HEAD.vm;
    const all: Mb51AgingThinRow[] = [];
    let p = 1;
    for (;;) {
      const chunk = await fetchMb51AggPage({
        paramHash,
        importId: activeImportId,
        page: p,
        pageSize: 500,
        q: searchQuery,
        sort: sortKey || 'total',
        sortDir,
        vendors: aggFilters.vendors,
        groups: aggFilters.groups,
        materials: aggFilters.materials,
        excludedMaterials: aggFilters.excludedMaterials,
      });
      all.push(...chunk.rows);
      if (all.length >= chunk.total || !chunk.rows.length) break;
      p++;
      if (p > 500) break;
    }
    const rws = all.map(thinToAgg);

    const aoa: (string | number)[][] = [
      ['MB51 Material Aging Report'],
      [
        'Basis date',
        serialToDMY(R.basis),
        'Posting date from',
        R.from < -1e8 ? '' : serialToDMY(R.from),
        'to',
        R.to > 1e8 ? '' : serialToDMY(R.to),
      ],
      [],
      [
        ...cols.map((c) => c[1]),
        ...BUCKETS.map((b) => b.l),
        `Stock as on ${serialToDMY(R.basis)}`,
        `Stock as per last updated on ${serialToDMY(R.maxD)}`,
      ],
    ];

    rws.forEach((r) => {
      aoa.push([...cols.map(([k]) => String(r[k] ?? '')), ...r.bk, r.total, r.full]);
    });

    aoa.push([
      'Grand total',
      ...cols.slice(1).map(() => ''),
      ...BUCKETS.map((_, i) => rws.reduce((s, r) => s + r.bk[i], 0)),
      rws.reduce((s, r) => s + r.total, 0),
      rws.reduce((s, r) => s + r.full, 0),
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      ...cols.map(([k]) => ({ wch: k === 'e' || k === 'b' ? 38 : 14 })),
      ...BUCKETS.map(() => ({ wch: 16 })),
      { wch: 20 },
      { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Aging');
    XLSX.writeFile(wb, `MB51_Aging_${serialToISO(R.basis)}.xlsx`);
  };

  const hasSummary = summary != null;
  const aggFilterKey = `${aggFilters.vendors.join('\0')}\n${aggFilters.groups.join('\0')}\n${aggFilters.materials.join('\0')}\n${aggFilters.excludedMaterials.join('\0')}`;

  // Reset to page 1 when search/sort/filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, sortKey, sortDir, paramHash, aggFilterKey]);

  // Server-paged thin rows (search/sort hit API).
  // Depend on hasSummary (boolean), not summary object — filter rollups rewrite
  // summary and used to retrigger this effect forever.
  useEffect(() => {
    if (!hasSummary || !paramHash) return;
    if (skipAggEffectRef.current) {
      skipAggEffectRef.current = false;
      return;
    }
    let active = true;
    void (async () => {
      setPageLoading(true);
      try {
        await loadAggPage(paramHash, page, searchQuery, sortKey || 'total', sortDir);
      } catch (err) {
        if (!active) return;
        console.error(err);
        setLoadMsg(err instanceof Error ? err.message : 'Failed to load rows');
        setIsErrMsg(true);
      } finally {
        if (active) setPageLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [paramHash, page, searchQuery, sortKey, sortDir, hasSummary, loadAggPage, aggFilterKey]);

  const displayedRows = reportResult?.rows ?? [];
  const shownRows = displayedRows;
  const totalPages = Math.max(1, Math.ceil(aggTotal / PAGE_SIZE) || 1);
  const gt = reportResult ? reportResult.tot.reduce((s, v) => s + v, 0) : 0;
  const currentCols = reportResult ? HEAD[reportResult.gb] || HEAD.vm : HEAD.vm;

  const openDetail = async (
    targetRows: Mb51AgingAggRow[],
    bucketIdx: number,
    title: string
  ) => {
    setModalTitle(title);
    setModalBucketIdx(bucketIdx);
    setModalNet(null);
    setModalLines([]);
    setModalOpen(true);
    try {
      const lines: [Mb51AgingMovement, number, number][] = [];
      for (const r of targetRows) {
        const key = String(r.groupKey || '');
        if (!key) continue;
        const data = await postMb51Detail({
          paramHash,
          importId: activeImportId,
          groupKey: key,
          bucketIdx,
        });
        lines.push(...(data.lines || []));
      }
      setModalLines(lines);
    } catch (err) {
      console.error(err);
      setModalLines([]);
    }
  };

  const openNet = async (targetRows: Mb51AgingAggRow[], title: string) => {
    setModalTitle(title);
    setModalBucketIdx(-2);
    setModalLines([]);
    setModalNet([]);
    setModalOpen(true);
    try {
      const L: {
        pos: number;
        neg: number;
        net: number;
        n: number;
        r: Mb51AgingMovement;
      }[] = [];
      for (const r of targetRows) {
        const key = String(r.groupKey || '');
        if (!key) continue;
        const data = await postMb51Detail({
          paramHash,
          importId: activeImportId,
          groupKey: key,
          bucketIdx: -2,
        });
        if (data.net) L.push(...data.net);
      }
      L.sort((x, y) => x.net - y.net);
      setModalNet(L);
    } catch (err) {
      console.error(err);
      setModalNet([]);
    }
  };

  // Export Excel for Drill-down modal
  const exportModalXls = () => {
    if (!reportResult) return;
    if (modalNet) {
      const aoa: (string | number)[][] = [
        [`${modalTitle} – net stock by vendor (all records)`],
        [],
        [
          'Plant',
          'Vendor code',
          'Vendor name',
          'Material',
          'Description',
          'UoM',
          'Lines',
          'Receipts (+)',
          'Issues / returns (-)',
          'Net stock',
        ],
      ];
      modalNet.forEach((x) =>
        aoa.push([x.r.mv, x.r.v, x.r.vn, x.r.m, x.r.md, x.r.u, x.n, x.pos, x.neg, x.net])
      );
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [8, 12, 28, 12, 34, 6, 8, 14, 16, 12].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Net stock');
      XLSX.writeFile(wb, 'MB51_Net_Stock_Detail.xlsx');
      return;
    }
    if (!modalLines.length) return;
    const bucketLabel = modalBucketIdx < 0 ? 'All periods' : BUCKETS[modalBucketIdx].l;
    const aoa: (string | number)[][] = [
      [`${modalTitle} – ${bucketLabel}`],
      ['Basis date', serialToDMY(reportResult.basis)],
      [],
      [
        'Plant',
        'Vendor code',
        'Vendor name',
        'Material',
        'Description',
        'Material group',
        'UoM',
        'Material doc',
        'Movement type',
        'Movement text',
        'Text',
        'Receipt posting date',
        'Receipt qty',
        'Qty in stock (FIFO)',
        'Age (days)',
        'Aging bucket',
      ],
    ];

    modalLines.forEach(([r, q, age]) => {
      aoa.push([
        r.mv,
        r.v,
        r.vn,
        r.m,
        r.md,
        r.g,
        r.u,
        r.dc ?? '',
        r.mt ?? '',
        r.mtx ?? '',
        r.tx ?? '',
        serialToDMY(r.d),
        r.q || 0,
        q,
        age,
        BUCKETS[bucketOf(age)].l,
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [8, 12, 28, 12, 34, 12, 6, 14, 8, 22, 16, 14, 12, 14, 10, 18].map((w) => ({
      wch: w,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Receipts');
    XLSX.writeFile(wb, 'MB51_Aging_Receipt_Detail.xlsx');
  };

  const rowTitle = (r: Mb51AgingAggRow) =>
    [r.a, r.b, r.d, r.e, r.c].filter(Boolean).join(' | ') || 'Total';

  return (
    <div className="mb51-app h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden">
      <header>
        <div>
          <h1>MB51 Material Aging Report (FIFO)</h1>
          <div className="sub">
            Aging calculated on Posting Date &nbsp;|&nbsp; Overall dataset (one FIFO snapshot)
            {latestImport?.importedAt && (
              <span>
                {' '}
                &bull; {latestImport.fileName} ({latestImport.rowCount.toLocaleString('en-IN')} rows)
                &bull; Saved: {new Date(latestImport.importedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="spacer" />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="btn" style={{ cursor: 'default' }}>
            Aging Report (FIFO)
          </span>
          <Link href="/report/mb51-table" className="btn sec" style={{ textDecoration: 'none' }}>
            Movements Table
          </Link>
          {(!!summary || imports.length > 0) && (
            <button
              type="button"
              className="btn sec"
              onClick={() => setShowUpload((s) => !s)}
            >
              {showUpload ? 'Back to report' : 'Load another file'}
            </button>
          )}
        </div>
      </header>

      <main>
        {/* Loading banner while reading/saving DB */}
        {loading && (
          <div className="card" style={{ textAlign: 'center', padding: '24px' }}>
            <b style={{ fontSize: '15px' }}>{loadMsg}</b>
          </div>
        )}

        {/* Errors only (save failure) — success "Loaded N rows…" banner removed */}
        {!loading && isErrMsg && loadMsg && !(showUpload && !summary) && (
          <div
            className="card status-banner"
            style={{
              padding: '6px 10px',
              borderColor: 'var(--neg)',
              background: '#fdf2f1',
            }}
          >
            <div className="msg err" style={{ marginTop: 0, fontSize: 12 }}>
              {loadMsg}
            </div>
          </div>
        )}

        {/* Upload Card */}
        {showUpload && (
          <div className="card" id="upCard">
            <div
              className={`drop ${isDragging ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <b>Select or drop one or more MB51 exports (.xlsx / .xls / .csv)</b>
              <div className="msg">
                Required: Posting Date, Material, Quantity (or Qty in unit of entry). Optional: Plant,
                Material Document, Material Description, Material Group, Base Unit of Measure /
                Unit of Entry, Supplier, SAP Vendor Name (from Vendor Master), Movement Type, Text. Files merge into the
                overall dataset; one FIFO snapshot is rebuilt (cross-file duplicates skipped; same-file duplicates kept).
              </div>
              <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn sec"
                  disabled={loading}
                  onClick={() => downloadMb51TemplateCsv('sap')}
                  title="Plant, Material Document, Posting Date, Material, Quantity, Base Unit of Measure, …"
                >
                  Template: SAP Quantity
                </button>
                <button
                  type="button"
                  className="btn sec"
                  disabled={loading}
                  onClick={() => downloadMb51TemplateCsv('qty-entry')}
                  title="Plant, Material Document, Posting Date, Material, Qty in unit of entry, Unit of Entry, …"
                >
                  Template: Qty in unit of entry
                </button>
              </p>
              <p>
                <input
                  type="file"
                  id="file"
                  accept=".xlsx,.xlsm,.xls,.csv"
                  multiple
                  disabled={loading}
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </p>
              {imports.length > 0 && (
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={forceNewImport}
                    onChange={(e) => setForceNewImport(e.target.checked)}
                  />
                  Start a separate import instead of growing the overall dataset (not recommended)
                </label>
              )}

              {availableSheets.length > 0 && (
                <div className="sheets">
                  <div style={{ width: '100%', marginBottom: 6 }}>
                    <b>Sheets to include:</b>
                  </div>
                  {availableSheets.map((sh) => (
                    <label key={sh.name}>
                      <input
                        type="checkbox"
                        checked={selectedSheets.has(sh.name)}
                        onChange={(e) => {
                          const next = new Set(selectedSheets);
                          if (e.target.checked) next.add(sh.name);
                          else next.delete(sh.name);
                          setSelectedSheets(next);
                        }}
                      />{' '}
                      {sh.name} <small>({sh.rowCount} rows)</small>
                    </label>
                  ))}
                  <div style={{ width: '100%', marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (!selectedSheets.size) {
                          setLoadMsg('Select at least one sheet.');
                          setIsErrMsg(true);
                          return;
                        }
                        if (wbInstance) {
                          processSheets(wbInstance, [...selectedSheets], 'MB51_Export.xlsx');
                        }
                      }}
                    >
                      Load selected sheets
                    </button>
                  </div>
                </div>
              )}

              {loadMsg && <div className={`msg ${isErrMsg ? 'err' : ''}`}>{loadMsg}</div>}
            </div>
          </div>
        )}

        {/* Report Application Content */}
        {!loading && !!summary && (
          <div id="app">
            {/* Filters Card */}
            <div className="card">
              <div className="filters">
                <div className="f">
                  <label>Aging basis date</label>
                  <input
                    type="date"
                    id="basis"
                    value={basisDate}
                    onChange={(e) => {
                      setBasisDate(e.target.value);
                    }}
                  />
                </div>
                <div className="f">
                  <label>Posting date from</label>
                  <input
                    type="date"
                    id="dFrom"
                    value={dateFrom}
                    min={minDateLimit}
                    max={maxDateLimit}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                    }}
                  />
                </div>
                <div className="f">
                  <label>Posting date to</label>
                  <input
                    type="date"
                    id="dTo"
                    value={dateTo}
                    min={minDateLimit}
                    max={maxDateLimit}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                    }}
                  />
                </div>
                <div className="f">
                  <label>Vendor code - Vendor name</label>
                  <MultiSelectDropdown
                    label="vendors"
                    items={vendorOptions}
                    selected={selectedVendors}
                    onChange={setSelectedVendors}
                    totalCount={facetTotals.vendors}
                    loadOptions={searchFacet('vendors')}
                    onDiscover={(item) => discoverFacet('vendors', item)}
                  />
                </div>
                <div className="f">
                  <label>Material group</label>
                  <MultiSelectDropdown
                    label="groups"
                    items={groupOptions}
                    selected={selectedGroups}
                    onChange={setSelectedGroups}
                    totalCount={facetTotals.groups}
                    loadOptions={searchFacet('groups')}
                    onDiscover={(item) => discoverFacet('groups', item)}
                  />
                </div>
                <div className="f">
                  <label>Material code - Material description</label>
                  <MultiSelectDropdown
                    label="materials"
                    items={matOptions}
                    selected={selectedMaterials}
                    onChange={setSelectedMaterials}
                    totalCount={facetTotals.materials}
                    loadOptions={async (q) =>
                      (await searchFacet('materials')(q)).filter(
                        (i) => !excludedMaterials.has(i.id)
                      )
                    }
                    onDiscover={(item) => discoverFacet('materials', item)}
                  />
                </div>
                <div className="f">
                  <label>Exclude materials</label>
                  <MultiSelectDropdown
                    label="materials to exclude"
                    emptyText={`None excluded (${facetTotals.materials.toLocaleString('en-IN')})`}
                    selectedOnlyLabel="Excluded only"
                    items={excludeMatOptions}
                    selected={excludedMaterials}
                    totalCount={facetTotals.materials}
                    loadOptions={searchFacet('materials')}
                    onDiscover={(item) => discoverFacet('materials', item)}
                    onChange={(next) => {
                      setExcludedMaterials(next);
                      setSelectedMaterials((prev) => {
                        if (!prev.size) return prev;
                        const kept = new Set([...prev].filter((id) => !next.has(id)));
                        return kept;
                      });
                    }}
                  />
                </div>
                <div className="f">
                  <label>Plant</label>
                  <MultiSelectDropdown
                    label="plants"
                    items={plantOptions}
                    selected={selectedPlants}
                    onChange={setSelectedPlants}
                    totalCount={facetTotals.plants}
                    loadOptions={searchFacet('plants')}
                    onDiscover={(item) => discoverFacet('plants', item)}
                  />
                </div>
                <div className="f">
                  <label>Group report by</label>
                  <select
                    id="grpBy"
                    value={groupBy}
                    onChange={(e) => {
                      setGroupBy(e.target.value as 'mat' | 'vendor' | 'group' | 'vm');
                    }}
                  >
                    <option value="vm">Vendor + Material</option>
                    <option value="mat">Material</option>
                    <option value="vendor">Vendor</option>
                    <option value="group">Material group</option>
                  </select>
                </div>
                <div className="f">
                  <label>Search in result</label>
                  <input
                    type="text"
                    id="q"
                    placeholder="type to filter rows…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    id="btnRun"
                    onClick={handleRun}
                  >
                    Generate
                  </button>
                  <button
                    type="button"
                    className="btn sec"
                    id="btnReset"
                    onClick={handleResetFilters}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn sec"
                    id="btnXls"
                    onClick={exportXls}
                  >
                    Export Excel
                  </button>
                </div>
              </div>
            </div>

            {/* KPI Summary Cards (Clickable for drill-down) */}
            <div className="card">
              <div className="kpis">
                {BUCKETS.map((b, i) => {
                  const val = reportResult ? reportResult.tot[i] : 0;
                  const absTotal = reportResult
                    ? reportResult.tot.reduce((s, v) => s + Math.abs(v), 0)
                    : 0;
                  const pct = absTotal ? (Math.abs(val) / absTotal) * 100 : 0;
                  return (
                    <div
                      key={b.k}
                      className="kpi click"
                      title="Click to see receipt details"
                      style={{ '--c': b.c } as React.CSSProperties}
                      onClick={() => {
                        if (reportResult) {
                          openDetail(reportResult.rows, i, 'All rows');
                        }
                      }}
                    >
                      <div className="l">{b.l}</div>
                      <div className="v">{fmtQtyDec(val)}</div>
                      <div className="p">{pct.toFixed(1)}% of |qty|</div>
                      <div className="bar">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Meta and Table — scroll stays inside .tw */}
            <div className="card table-card">
              {reportResult && (
                <div className="meta">
                  <span>
                    Basis date: <b>{serialToDMY(reportResult.basis)}</b>
                  </span>
                  {sheetLabel && (
                    <span>
                      Sheets: <b>{sheetLabel}</b>
                    </span>
                  )}
                  {excludedMaterials.size > 0 && (
                    <span style={{ color: 'var(--neg)' }}>
                      Excluded materials: <b>{excludedMaterials.size.toLocaleString('en-IN')}</b>
                    </span>
                  )}
                  <span>
                    Posting date range:{' '}
                    <b>{reportResult.from < -1e8 ? '–' : serialToDMY(reportResult.from)}</b> to{' '}
                    <b>{reportResult.to > 1e8 ? '–' : serialToDMY(reportResult.to)}</b>
                  </span>
                  <span>
                    Stock items: <b>{reportResult.stockMat.toLocaleString('en-IN')}</b>
                  </span>
                  <span>
                    Receipt layers: <b>{reportResult.used.toLocaleString('en-IN')}</b>
                  </span>
                  <span>
                    Result rows: <b>{aggTotal.toLocaleString('en-IN')}</b>
                  </span>
                  <span>
                    Stock as on {serialToDMY(reportResult.basis)}: <b>{fmtQty(gt)}</b>
                  </span>
                  <span>
                    Stock as per last updated on {serialToDMY(reportResult.maxD)}:{' '}
                    <b>{fmtQty(reportResult.fullTot)}</b>
                  </span>
                </div>
              )}

              {pageLoading && (
                <div className="page-loading" role="status" aria-live="polite">
                  Loading data…
                </div>
              )}
              <div
                className={`tw${pageLoading ? ' is-paging' : ''}`}
                role="region"
                aria-busy={pageLoading}
                aria-label="Aging results"
              >
                <table>
                  <thead>
                    <tr>
                      {currentCols.map(([k, label]) => (
                        <th
                          key={k}
                          className={headColClass(k)}
                          onClick={() => {
                            if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
                            else {
                              setSortKey(k);
                              setSortDir(1);
                            }
                          }}
                        >
                          {label}
                          {sortKey === k && (
                            <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>
                          )}
                        </th>
                      ))}
                      {BUCKETS.map((b, i) => {
                        const bkKey = `b${i + 1}`;
                        const split = b.l.match(/^(.*)\s+(days|years)$/i);
                        return (
                          <th
                            key={bkKey}
                            className="n bk"
                            title={b.l}
                            onClick={() => {
                              if (sortKey === bkKey) setSortDir((d) => (d === 1 ? -1 : 1));
                              else {
                                setSortKey(bkKey);
                                setSortDir(-1);
                              }
                            }}
                          >
                            {split ? (
                              <>
                                {split[1]}
                                <br />
                                {split[2]}
                              </>
                            ) : (
                              b.l
                            )}
                            {sortKey === bkKey && (
                              <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>
                            )}
                          </th>
                        );
                      })}
                      <th
                        className="n tot"
                        title="Net stock as on the selected basis date"
                        onClick={() => {
                          if (sortKey === 'total') setSortDir((d) => (d === 1 ? -1 : 1));
                          else {
                            setSortKey('total');
                            setSortDir(-1);
                          }
                        }}
                      >
                        Stock as on
                        <br />
                        {reportResult ? serialToDMY(reportResult.basis) : '–'}
                        {sortKey === 'total' && (
                          <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>
                        )}
                      </th>
                      <th
                        className="n tot2"
                        title="Net qty of all records in the file"
                        onClick={() => {
                          if (sortKey === 'full') setSortDir((d) => (d === 1 ? -1 : 1));
                          else {
                            setSortKey('full');
                            setSortDir(-1);
                          }
                        }}
                      >
                        Stock as per last updated on
                        <br />
                        {reportResult ? serialToDMY(reportResult.maxD) : '–'}
                        {sortKey === 'full' && (
                          <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.length > 0 ? (
                      shownRows.map((r, rowIdx) => (
                        <tr key={rowIdx}>
                          {currentCols.map(([k]) => {
                            const text = String(r[k] ?? '');
                            const cls = headColClass(k);
                            return (
                              <td
                                key={k}
                                className={cls}
                                title={cls === 'clip' ? text : undefined}
                              >
                                {text}
                              </td>
                            );
                          })}
                          {r.bk.map((val, bIdx) => (
                            <td
                              key={bIdx}
                              className={`n bk ${val < 0 ? 'neg' : ''} ${
                                Math.abs(val) < 1e-9 ? 'z' : 'click'
                              }`}
                              title={Math.abs(val) < 1e-9 ? undefined : 'Click to see receipt details'}
                              onClick={() => {
                                if (Math.abs(val) >= 1e-9) {
                                  openDetail([r], bIdx, rowTitle(r));
                                }
                              }}
                            >
                              {fmtQty(val)}
                            </td>
                          ))}
                          <td
                            className={`n tot click ${r.total < 0 ? 'neg' : ''}`}
                            title="Click to see receipt details"
                            onClick={() => openDetail([r], -1, rowTitle(r))}
                          >
                            {fmtQty(r.total)}
                          </td>
                          <td
                            className={`n tot2 click ${r.full < 0 ? 'neg' : ''}`}
                            title="Click for net stock breakdown (all records)"
                            onClick={() => openNet([r], rowTitle(r))}
                          >
                            {fmtQty(r.full)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={currentCols.length + BUCKETS.length + 2}
                          className="empty"
                        >
                          No movements match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {displayedRows.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={currentCols.length}>
                          Page total ({displayedRows.length.toLocaleString('en-IN')} of {aggTotal.toLocaleString('en-IN')})
                        </td>
                        {BUCKETS.map((_, i) => {
                          const bucketSum = displayedRows.reduce(
                            (s, r) => s + (r.bk[i] || 0),
                            0
                          );
                          return (
                            <td
                              key={i}
                              className="n bk click"
                              title="Click to see receipt details"
                              onClick={() =>
                                openDetail(displayedRows, i, 'All displayed rows')
                              }
                            >
                              {fmtQty(bucketSum)}
                            </td>
                          );
                        })}
                        <td
                          className="n click"
                          title="Click to see receipt details"
                          onClick={() =>
                            openDetail(displayedRows, -1, 'All displayed rows')
                          }
                        >
                          {fmtQty(displayedRows.reduce((s, r) => s + r.total, 0))}
                        </td>
                        <td
                          className="n tot2 click"
                          title="Click for net stock breakdown (all records)"
                          onClick={() => openNet(displayedRows, 'All displayed rows')}
                        >
                          {fmtQty(displayedRows.reduce((s, r) => s + r.full, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {(displayedRows.length > 0 || pageLoading) && (
                <div className="pager">
                  <span>
                    {pageLoading
                      ? `Loading page ${page} of ${totalPages}…`
                      : `Page ${page} of ${totalPages} · showing ${shownRows.length.toLocaleString('en-IN')} of ${aggTotal.toLocaleString('en-IN')} rows`}
                  </span>
                  <div className="pager-btns">
                    <button
                      type="button"
                      className="btn sec"
                      disabled={pageLoading || page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      className="btn sec"
                      disabled={pageLoading || page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {reportResult && (
                <div className="note">
                  FIFO basis: closing balance (net qty of postings within the selected
                  posting-date range, up to the basis date) per Plant + Vendor + Material is
                  allocated to the latest receipts (positive qty), because the oldest receipts
                  are consumed first. Age = Basis date − receipt Posting Date.{' '}
                  {uomInfo}{' '}
                  Buckets (age in days): 0–30, 31–90, 91–180, 181–365, 366–730 (1–2 yr),
                  731–1095 (2–3 yr), 1096+ (&gt;3 yr). Stock as on basis date = sum of buckets
                  (items with zero/negative balance excluded, so aging is never negative). Stock
                  as on {serialToDMY(reportResult.maxD)} = net qty of all records in the file
                  (not limited by basis date or range).
                  {reportResult.negMat > 0 &&
                    ` ${reportResult.negMat.toLocaleString(
                      'en-IN'
                    )} item(s) with negative balance (${fmtQty(
                      reportResult.negQty
                    )}) excluded.`}
                  {reportResult.plugged > 0 &&
                    ` ${reportResult.plugged.toLocaleString(
                      'en-IN'
                    )} item(s) had balance (${fmtQty(
                      reportResult.plugQty
                    )}) exceeding receipts in the file – shown in the oldest bucket of its first posting.`}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Drill-down Detail Modal */}
      {modalOpen && (
        <div
          id="modal"
          className="modal"
          onClick={(e) => {
            if ((e.target as HTMLElement).id === 'modal') setModalOpen(false);
          }}
        >
          <div className="mbox">
            <div className="mhead">
              <div>
                <div id="mTitle" className="mt">
                  {modalNet
                    ? `${modalTitle} – Net stock as on ${
                        reportResult ? serialToDMY(reportResult.maxD) : '–'
                      } (all records)`
                    : `${modalTitle} – ${
                        modalBucketIdx < 0 ? 'All periods' : BUCKETS[modalBucketIdx]?.l
                      }`}
                </div>
                <div id="mSub" className="msub">
                  {modalNet ? (
                    <>
                      Net stock = all receipts (+) less all issues/returns (−) per Plant +
                      Vendor + Material
                      {sheetLabel ? (
                        <>
                          , from the sheet(s) loaded: <b>{sheetLabel}</b>
                        </>
                      ) : null}
                      . Sorted lowest first.
                    </>
                  ) : (
                    <>
                      Basis date{' '}
                      <b>{reportResult ? serialToDMY(reportResult.basis) : '–'}</b>{' '}
                      &nbsp;|&nbsp; Receipt lines: <b>{modalLines.length}</b> &nbsp;|&nbsp;
                      Stock qty (FIFO allocated):{' '}
                      <b>{fmtQty(modalLines.reduce((s, x) => s + x[1], 0))}</b>
                    </>
                  )}
                </div>
              </div>
              <div className="mact">
                <button
                  type="button"
                  className="btn sec"
                  id="mXls"
                  onClick={exportModalXls}
                >
                  Export Excel
                </button>
                <button
                  type="button"
                  className="btn"
                  id="mClose"
                  onClick={() => setModalOpen(false)}
                >
                  Close ✕
                </button>
              </div>
            </div>
            <div className="mbody" id="mBody">
              {modalNet ? (
                <table id="mTbl">
                  <thead>
                    <tr>
                      <th>Plant</th>
                      <th>Vendor</th>
                      <th>Material</th>
                      <th>Description</th>
                      <th>UoM</th>
                      <th className="n">Lines</th>
                      <th className="n">Receipts (+)</th>
                      <th className="n">Issues / returns (−)</th>
                      <th className="n">Net stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalNet.map((x, idx) => (
                      <tr key={idx}>
                        <td>{x.r.mv}</td>
                        <td>
                          {x.r.v} - {x.r.vn}
                        </td>
                        <td>{x.r.m}</td>
                        <td>{x.r.md}</td>
                        <td>{x.r.u}</td>
                        <td className="n">{x.n}</td>
                        <td className="n">{fmtQty(x.pos)}</td>
                        <td className="n neg">{fmtQty(x.neg)}</td>
                        <td className={`n tot ${x.net < -1e-9 ? 'neg' : ''}`}>
                          {fmtQty(x.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}>Total ({modalNet.length} vendor lines)</td>
                      <td className="n">
                        {fmtQty(modalNet.reduce((s, x) => s + x.pos, 0))}
                      </td>
                      <td className="n neg">
                        {fmtQty(modalNet.reduce((s, x) => s + x.neg, 0))}
                      </td>
                      <td
                        className={`n ${
                          modalNet.reduce((s, x) => s + x.net, 0) < -1e-9 ? 'neg' : ''
                        }`}
                      >
                        {fmtQty(modalNet.reduce((s, x) => s + x.net, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <table id="mTbl">
                  <thead>
                    <tr>
                      <th>Plant</th>
                      <th>Vendor</th>
                      <th>Material</th>
                      <th>Description</th>
                      <th>Material doc</th>
                      <th>Mov. type</th>
                      <th>Text</th>
                      <th>Receipt posting date</th>
                      <th className="n">Receipt qty</th>
                      <th className="n">Qty in stock (FIFO)</th>
                      <th className="n">Age (days)</th>
                      <th>Aging bucket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalLines.map(([r, q, age], idx) => (
                      <tr key={idx}>
                        <td>{r.mv}</td>
                        <td>
                          {r.v} - {r.vn}
                        </td>
                        <td>{r.m}</td>
                        <td>{r.md}</td>
                        <td>{r.dc}</td>
                        <td>
                          {r.mt} {r.mtx}
                        </td>
                        <td>{r.tx}</td>
                        <td>{serialToDMY(r.d)}</td>
                        <td className="n">{fmtQty(r.q || 0)}</td>
                        <td className="n tot">{fmtQty(q)}</td>
                        <td className="n">{age}</td>
                        <td>{BUCKETS[bucketOf(age)].l}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={8}>Total</td>
                      <td className="n">
                        {fmtQty(modalLines.reduce((s, x) => s + (x[0].q || 0), 0))}
                      </td>
                      <td className="n">
                        {fmtQty(modalLines.reduce((s, x) => s + x[1], 0))}
                      </td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .mb51-app {
          --bg: #f4f6f9;
          --card: #fff;
          --ink: #1c2733;
          --muted: #64748b;
          --line: #dde3ea;
          --brand: #0b5cab;
          --brand-d: #084580;
          --accent: #e8f1fb;
          --neg: #c0392b;
          --ok: #1e8e5a;
          --b1: #2e9e6b;
          --b2: #7cb342;
          --b3: #f2b01e;
          --b4: #f08a24;
          --b5: #e0592a;
          --b6: #c0392b;
          --b7: #8e1f2f;
          font: 13px/1.4 "Segoe UI", Roboto, Arial, sans-serif;
          background: var(--bg);
          color: var(--ink);
          display: flex;
          flex-direction: column;
          max-width: 100%;
          min-width: 0;
        }
        .mb51-app * {
          box-sizing: border-box;
        }
        .mb51-app header {
          flex-shrink: 0;
          background: var(--brand-d);
          color: #fff;
          padding: 8px 14px;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .mb51-app header h1 {
          font-size: 16px;
          margin: 0;
          font-weight: 600;
        }
        .mb51-app header .sub {
          opacity: 0.75;
          font-size: 11px;
        }
        .mb51-app header .spacer {
          flex: 1;
        }
        .mb51-app .import-pick {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #dbe7f5;
        }
        .mb51-app .import-pick select {
          max-width: min(360px, 42vw);
          height: 28px;
          border: 1px solid #7ea0c4;
          border-radius: 5px;
          padding: 0 6px;
          background: #0a4a8c;
          color: #fff;
          font: inherit;
          font-size: 12px;
        }
        .mb51-app main {
          flex: 1 1 0;
          min-height: 0;
          min-width: 0;
          max-width: 100%;
          margin: 0;
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .mb51-app #app {
          flex: 1 1 0;
          min-height: 0;
          min-width: 0;
          max-width: 100%;
          display: flex;
          flex-direction: column;
          gap: 0;
          overflow: hidden;
        }
        .mb51-app .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 8px;
          min-width: 0;
          max-width: 100%;
          flex-shrink: 0;
        }
        .mb51-app .card.table-card {
          display: flex;
          flex-direction: column;
          flex: 1 1 0;
          min-height: 0;
          margin-bottom: 0;
          overflow: hidden;
        }
        .mb51-app .filters {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 6px 8px;
          align-items: end;
        }
        .mb51-app .f label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 3px;
        }
        .mb51-app input[type='date'],
        .mb51-app select,
        .mb51-app .ms-btn,
        .mb51-app input[type='text'] {
          width: 100%;
          height: 28px;
          border: 1px solid #c5cdd7;
          border-radius: 5px;
          padding: 0 6px;
          background: #fff;
          font: inherit;
          font-size: 12px;
          color: var(--ink);
        }
        .mb51-app input:focus,
        .mb51-app select:focus,
        .mb51-app .ms-btn:focus {
          outline: 2px solid #86b6e8;
          outline-offset: 0;
        }
        .mb51-app .btn {
          white-space: nowrap;
          height: 28px;
          padding: 0 10px;
          border-radius: 5px;
          border: 1px solid var(--brand);
          background: var(--brand);
          color: #fff;
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .mb51-app .btn:hover {
          background: var(--brand-d);
        }
        .mb51-app .btn.sec {
          background: #fff;
          color: var(--brand);
        }
        .mb51-app .btn.sec:hover {
          background: var(--accent);
        }
        .mb51-app .btn[disabled] {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .mb51-app .actions {
          display: flex;
          gap: 8px;
          align-items: end;
        }
        .mb51-app .ms {
          position: relative;
        }
        .mb51-app .ms-btn {
          text-align: left;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .mb51-app .ms-btn span.t {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mb51-app .ms-btn::after {
          content: '▾';
          color: var(--muted);
        }
        .mb51-app .ms-pop {
          position: absolute;
          z-index: 50;
          top: 32px;
          left: 0;
          min-width: 100%;
          width: max(100%, 320px);
          max-width: min(420px, 92vw);
          background: #fff;
          border: 1px solid #b7c2cf;
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        }
        .mb51-app .ms-top {
          padding: 6px;
          border-bottom: 1px solid var(--line);
          display: flex;
          gap: 6px;
        }
        .mb51-app .ms-top input {
          flex: 1;
        }
        .mb51-app .ms-top button {
          border: 1px solid #c5cdd7;
          background: #f7f9fb;
          border-radius: 5px;
          padding: 0 8px;
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          white-space: nowrap;
        }
        .mb51-app .ms-top button.on {
          background: var(--accent);
          border-color: var(--brand);
          color: var(--brand-d);
          font-weight: 600;
        }
        .mb51-app .ms-top button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .mb51-app .ms-list {
          max-height: 260px;
          overflow: auto;
        }
        .mb51-app .ms-item {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 4px 10px;
          cursor: pointer;
        }
        .mb51-app .ms-item:hover {
          background: var(--accent);
        }
        .mb51-app .ms-item input {
          margin: 0;
        }
        .mb51-app .ms-foot {
          padding: 4px 10px;
          font-size: 11px;
          color: var(--muted);
          border-top: 1px solid var(--line);
        }
        .mb51-app .drop {
          border: 2px dashed #9db4cc;
          border-radius: 8px;
          padding: 28px;
          text-align: center;
          background: #fafcfe;
        }
        .mb51-app .drop.over {
          background: var(--accent);
          border-color: var(--brand);
        }
        .mb51-app .drop b {
          font-size: 15px;
        }
        .mb51-app .sheets {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 10px;
          justify-content: center;
        }
        .mb51-app .msg {
          margin-top: 8px;
          color: var(--muted);
        }
        .mb51-app .err {
          color: var(--neg);
        }
        .mb51-app .kpis {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
          min-width: 0;
        }
        .mb51-app .kpi {
          border: 1px solid var(--line);
          border-radius: 5px;
          padding: 4px 6px;
          background: #fff;
          border-top: 3px solid var(--c);
          min-width: 0;
          overflow: hidden;
        }
        .mb51-app .kpi.click,
        .mb51-app td.click {
          cursor: pointer;
        }
        .mb51-app td.click:hover {
          background: #dcebfa !important;
          text-decoration: underline;
          color: var(--brand);
        }
        .mb51-app .kpi.click:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }
        .mb51-app .kpi .l {
          font-size: 10px;
          color: var(--muted);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mb51-app .kpi .v {
          font-size: 14px;
          font-weight: 700;
          margin-top: 1px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mb51-app .kpi .p {
          display: none; /* compact chrome — % is secondary to qty */
        }
        .mb51-app .kpi .bar {
          height: 3px;
          background: #eef1f5;
          border-radius: 2px;
          margin-top: 3px;
          overflow: hidden;
        }
        .mb51-app .kpi .bar i {
          display: block;
          height: 100%;
          background: var(--c);
        }
        .mb51-app .meta {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          color: var(--muted);
          font-size: 11px;
          margin-bottom: 6px;
          flex-shrink: 0;
        }
        .mb51-app .meta b {
          color: var(--ink);
        }
        /* Vertical scroll only — table fills pane width (no horizontal bar) */
        .mb51-app .tw {
          flex: 1 1 0;
          min-height: 10rem;
          min-width: 0;
          width: 100%;
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 1px solid var(--line);
          border-radius: 6px;
          scrollbar-width: thin;
          scrollbar-color: #5f82a8 #e9eef4;
        }
        .mb51-app .tw::-webkit-scrollbar {
          width: 10px;
        }
        .mb51-app .tw::-webkit-scrollbar-track {
          background: #e9eef4;
        }
        .mb51-app .tw::-webkit-scrollbar-thumb {
          background: #5f82a8;
          border-radius: 5px;
          border: 2px solid #e9eef4;
        }
        .mb51-app .tw::-webkit-scrollbar-thumb:hover {
          background: #3f6a94;
        }
        .mb51-app .page-loading {
          flex-shrink: 0;
          padding: 6px 10px;
          margin-bottom: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--accent, #1d4f7a);
          background: #eef5fb;
          border: 1px solid #c5d8ea;
          border-radius: 6px;
        }
        .mb51-app .tw.is-paging {
          opacity: 0.45;
          pointer-events: none;
        }
        .mb51-app .pager {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-shrink: 0;
          padding-top: 6px;
          font-size: 12px;
          color: var(--muted);
        }
        .mb51-app .pager-btns {
          display: flex;
          gap: 6px;
        }
        .mb51-app .pager .btn {
          height: 28px;
          padding: 0 10px;
          font-size: 12px;
        }
        .mb51-app .tw table {
          border-collapse: separate;
          border-spacing: 0;
          width: 100%;
          table-layout: fixed;
          font-variant-numeric: tabular-nums;
        }
        /* Skip layout of off-screen rows so sidebar resize stays cheap */
        .mb51-app .tw tbody tr {
          content-visibility: auto;
          contain-intrinsic-size: auto 28px;
        }
        .mb51-app .tw th,
        .mb51-app .tw td {
          padding: 4px 5px;
          border-bottom: 1px solid #edf0f4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mb51-app .tw th.code,
        .mb51-app .tw td.code {
          width: 6%;
        }
        .mb51-app .tw th.clip,
        .mb51-app .tw td.clip {
          width: 11%;
        }
        .mb51-app .tw th.grp,
        .mb51-app .tw td.grp {
          width: 7%;
        }
        .mb51-app .tw th.uom,
        .mb51-app .tw td.uom {
          width: 3.5%;
          text-align: center;
        }
        .mb51-app .tw th.bk,
        .mb51-app .tw td.bk {
          width: 5.5%;
        }
        .mb51-app .tw th.bk {
          white-space: normal;
          line-height: 1.15;
          font-size: 10px;
          text-align: center;
          text-overflow: clip;
        }
        .mb51-app .tw th.tot,
        .mb51-app .tw th.tot2,
        .mb51-app .tw td.tot,
        .mb51-app .tw td.tot2 {
          width: 6.5%;
        }
        .mb51-app .tw th.tot,
        .mb51-app .tw th.tot2 {
          white-space: normal;
          line-height: 1.2;
          text-overflow: clip;
        }
        .mb51-app .tw thead th {
          position: sticky;
          top: 0;
          background: #eaf0f7;
          z-index: 2;
          text-align: left;
          font-size: 11px;
          line-height: 1.25;
          cursor: pointer;
          user-select: none;
          border-bottom: 2px solid #b9c7d8;
          white-space: normal;
        }
        .mb51-app .tw thead th.n {
          text-align: right;
        }
        .mb51-app .tw thead th:hover {
          background: #dce7f4;
        }
        .mb51-app .tw thead th .ar {
          opacity: 0.5;
          font-size: 10px;
          margin-left: 3px;
        }
        .mb51-app .tw td.n {
          text-align: right;
        }
        .mb51-app .tw td.neg {
          color: var(--neg);
        }
        .mb51-app .tw td.z {
          color: #b6bfca;
        }
        .mb51-app .tw tbody tr:hover td {
          background: #f3f8fe;
        }
        .mb51-app .tw tfoot td {
          position: sticky;
          bottom: 0;
          background: #eaf0f7;
          font-weight: 700;
          border-top: 2px solid #b9c7d8;
        }
        .mb51-app .tw td.tot,
        .mb51-app .tw th.tot {
          background: #f6f9fc;
          font-weight: 700;
        }
        .mb51-app .tw td.tot2,
        .mb51-app .tw th.tot2 {
          background: #fff6e6;
          font-weight: 700;
        }
        .mb51-app .tw tfoot td.tot2 {
          background: #eaf0f7;
        }
        .mb51-app .empty {
          padding: 40px;
          text-align: center;
          color: var(--muted);
        }
        .mb51-app .note {
          font-size: 10px;
          color: var(--muted);
          margin-top: 6px;
          line-height: 1.35;
          max-height: 3.2em;
          overflow: auto;
          flex-shrink: 0;
        }

        /* Modal Styles */
        .mb51-app .modal {
          position: fixed;
          inset: 0;
          background: rgba(15, 25, 40, 0.55);
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .mb51-app .mbox {
          background: #fff;
          border-radius: 10px;
          width: min(1400px, 100%);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
        }
        .mb51-app .mhead {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--line);
          align-items: flex-start;
        }
        .mb51-app .mt {
          font-size: 15px;
          font-weight: 700;
        }
        .mb51-app .msub {
          color: var(--muted);
          margin-top: 3px;
        }
        .mb51-app .mact {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .mb51-app .mbody {
          min-height: 0;
          flex: 1;
          overflow: auto;
          padding: 0 16px;
        }
        /* Modal table: content-sized columns (do not inherit main-grid clamps) */
        .mb51-app .mbody table {
          border-collapse: separate;
          border-spacing: 0;
          width: max-content;
          min-width: 100%;
          table-layout: auto;
          font-variant-numeric: tabular-nums;
        }
        .mb51-app .mbody th,
        .mb51-app .mbody td {
          padding: 5px 9px;
          border-bottom: 1px solid #edf0f4;
          white-space: nowrap;
          overflow: visible;
          max-width: none;
        }
        .mb51-app .mbody thead th {
          position: sticky;
          top: 0;
          background: #eaf0f7;
          z-index: 2;
          text-align: left;
          font-size: 12px;
          border-bottom: 2px solid #b9c7d8;
          white-space: nowrap;
        }
        .mb51-app .mbody thead th.n,
        .mb51-app .mbody td.n {
          text-align: right;
        }
        .mb51-app .mbody td.neg {
          color: var(--neg);
        }
        .mb51-app .mbody td.tot,
        .mb51-app .mbody th.tot {
          background: #f6f9fc;
          font-weight: 700;
        }
        .mb51-app .mbody tfoot td {
          position: sticky;
          bottom: 0;
          background: #eaf0f7;
          font-weight: 700;
          border-top: 2px solid #b9c7d8;
        }
        .mb51-app .mbody tbody tr:hover td {
          background: #f3f8fe;
        }

        @media (max-width: 1100px) {
          .mb51-app .kpis {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .mb51-app .tw {
            height: min(65vh, calc(100dvh - 300px));
            max-height: min(65vh, calc(100dvh - 300px));
          }
        }
        @media print {
          .mb51-app header,
          .mb51-app .filters,
          .mb51-app .actions,
          .mb51-app .drop,
          .mb51-app #upCard {
            display: none;
          }
          .mb51-app .tw {
            max-height: none;
            overflow: visible;
          }
        }
      `}</style>
    </div>
  );
}
