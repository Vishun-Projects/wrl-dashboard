'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import type {
  Mb51AgingMovement,
  Mb51AgingImportMeta,
  Mb51AgingAggRow,
  Mb51AgingResult,
} from '@/modules/mb51-aging/types';
import { saveMb51AgingRows } from '@/modules/mb51-aging/save-client';
import {
  BUCKETS,
  DEFAULT_DEFECTIVE_MATERIALS,
  bucketOf,
  computeFifoAging,
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

function toSerial(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.floor(v);
  if (v instanceof Date) {
    return Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / DAY + EPOCH_OFFSET);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / DAY + EPOCH_OFFSET;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY + EPOCH_OFFSET;
  return null;
}

const fmtQty = (v: number): string => {
  if (v === 0 || Math.abs(v) < 1e-9) return '–';
  const n = Math.round(v);
  if (n === 0) return '–';
  const s = Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
};

const norm = (s: unknown) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Match MB51_Aging_Report.html — prefer Quantity + Base Unit of Measure when both exist. */
const COLS: Record<string, string[]> = {
  date: ['postingdate'],
  mat: ['material'],
  desc: ['materialdescription'],
  grp: ['materialgroup'],
  qty: ['quantity', 'qtyinunitofentry', 'qty'],
  sup: ['supplier', 'vendor'],
  supn: ['suppliername', 'vendorname'],
  uom: ['baseunitofmeasure', 'unitofentry', 'uom'],
  mov: ['movementtype'],
  movt: ['movementtypetext'],
  doc: ['materialdocument'],
  plant: ['plant'],
};

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
}: {
  label: string;
  items: OptionItem[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  /** Shown when nothing is selected (default: All {label}). */
  emptyText?: string;
  /** Toggle button label to list only checked items (e.g. "Excluded only"). */
  selectedOnlyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;
    if (selectedOnly) list = list.filter((i) => selected.has(i.id));
    return q ? list.filter((i) => i.lc.includes(q)) : list;
  }, [items, query, selectedOnly, selected]);

  const lim = 400;
  const part = shown.slice(0, lim);

  const buttonText = useMemo(() => {
    const n = selected.size;
    if (n === 0) return emptyText ?? `All ${label} (${items.length})`;
    if (n === 1) {
      const match = items.find((i) => selected.has(i.id));
      return match ? match.text : '1 selected';
    }
    return `${n} selected`;
  }, [selected, label, items, emptyText]);

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
                shown.forEach((i) => next.add(i.id));
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
                      if (e.target.checked) next.add(i.id);
                      else next.delete(i.id);
                      onChange(next);
                    }}
                  />
                  <span>{i.text}</span>
                </label>
              ))
            ) : (
              <div className="empty">
                {selectedOnly ? 'No excluded materials' : 'No match'}
              </div>
            )}
          </div>
          <div className="ms-foot">
            {selectedOnly
              ? `${shown.length} excluded`
              : `${shown.length} of ${items.length} shown`}
            {shown.length > lim ? ` (first ${lim} – refine search)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Mb51AgingPageClient() {
  const [rows, setRows] = useState<Mb51AgingMovement[]>([]);
  const [latestImport, setLatestImport] = useState<Mb51AgingImportMeta | null>(null);
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
  const [maxPostingSerial, setMaxPostingSerial] = useState(0);
  /** Any materials the user wants dropped from aging (not limited to the known 6). */
  const [excludedMaterials, setExcludedMaterials] = useState<Set<string>>(new Set());
  const [sheetLabel, setSheetLabel] = useState('');
  const [uomInfo, setUomInfo] = useState('');

  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [selectedPlants, setSelectedPlants] = useState<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState(-1);
  /** Keep DOM small — full result stays in memory; Export still has all rows. */
  const [page, setPage] = useState(0);

  // Result state
  const [reportResult, setReportResult] = useState<Mb51AgingResult | null>(null);

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

  const runAging = useCallback(
    (opts: {
      movRows: Mb51AgingMovement[];
      basisDateStr: string;
      dateFromStr: string;
      dateToStr: string;
      gb: 'mat' | 'vendor' | 'group' | 'vm';
      plants: Set<string>;
      vendors: Set<string>;
      groups: Set<string>;
      materials: Set<string>;
      excluded: Set<string>;
      maxD: number;
    }) => {
      const basis = dateToSerial(opts.basisDateStr);
      if (basis == null) return null;
      return computeFifoAging({
        rows: opts.movRows,
        basis,
        from: dateToSerial(opts.dateFromStr) ?? -1e9,
        to: dateToSerial(opts.dateToStr) ?? 1e9,
        groupBy: opts.gb,
        selectedPlants: opts.plants,
        selectedVendors: opts.vendors,
        selectedGroups: opts.groups,
        selectedMaterials: opts.materials,
        excludedMaterials: opts.excluded,
        maxD: opts.maxD,
      });
    },
    []
  );

  // Function to initialize dates & report synchronously from a dataset
  const initFromRows = useCallback(
    (movRows: Mb51AgingMovement[], gb: 'mat' | 'vendor' | 'group' | 'vm' = 'vm') => {
      if (!movRows.length) return;
      let mn = 1e9,
        mx = -1e9;
      const codes = new Set<string>();
      for (const r of movRows) {
        if (r.d < mn) mn = r.d;
        if (r.d > mx) mx = r.d;
        if (r.m) codes.add(r.m);
      }
      const isoMn = serialToISO(mn);
      const isoMx = serialToISO(mx);
      const today = new Date();
      const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);
      // Seed with known defective codes present in this file; user can add any more / all
      const seedExcluded = new Set(
        DEFAULT_DEFECTIVE_MATERIALS.filter((m) => codes.has(m))
      );

      setDateFrom(isoMn);
      setDateTo(isoMx);
      setMinDateLimit(isoMn);
      setMaxDateLimit(isoMx);
      setMaxPostingSerial(mx);
      setBasisDate(todayIso);
      setGroupBy(gb);
      setExcludedMaterials(seedExcluded);
      setSelectedVendors(new Set());
      setSelectedGroups(new Set());
      setSelectedMaterials(new Set());
      setSelectedPlants(new Set());

      const computed = runAging({
        movRows,
        basisDateStr: todayIso,
        dateFromStr: isoMn,
        dateToStr: isoMx,
        gb,
        plants: new Set(),
        vendors: new Set(),
        groups: new Set(),
        materials: new Set(),
        excluded: seedExcluded,
        maxD: mx,
      });

      setReportResult(computed);
      setRows(movRows);
      setShowUpload(false);
    },
    [runAging]
  );

  // Initial load from database
  useEffect(() => {
    let active = true;
    async function loadSavedData() {
      try {
        setLoading(true);
        setLoadMsg('Loading MB51 Aging Report from portal database…');
        const res = await fetch('/api/report/mb51-aging', { credentials: 'include' });
        if (!res.ok) {
          throw new Error(`Failed to load data (${res.status})`);
        }
        const data = await res.json();
        if (!active) return;

        if (data.rows && data.rows.length > 0) {
          setLatestImport(data.latestImport || null);
          setLoadMsg('');
          setIsErrMsg(false);
          initFromRows(data.rows, 'vm');
        } else {
          setLoadMsg('No saved data found in database. Please upload your MB51 export file.');
          setIsErrMsg(false);
          setShowUpload(true);
        }
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
    loadSavedData();
    return () => {
      active = false;
    };
  }, [initFromRows]);

  // Filter options derived from current rows
  const { vendorOptions, groupOptions, matOptions, plantOptions, excludeMatOptions } =
    useMemo(() => {
      const V = new Map<string, string>();
      const G = new Map<string, string>();
      const M = new Map<string, string>();
      const MV = new Map<string, string>();

      for (const r of rows) {
        if (!V.has(r.v)) V.set(r.v, `${r.v || '(blank)'} - ${r.vn || ''}`);
        G.set(r.g, r.g || '(blank)');
        if (!M.has(r.m)) M.set(r.m, `${r.m} - ${r.md}`);
        MV.set(r.mv, r.mv || '(blank)');
      }

      const sortOpt = (map: Map<string, string>): OptionItem[] =>
        [...map.entries()]
          .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
          .map(([id, text]) => ({ id, text, lc: text.toLowerCase() }));

      const allMats = sortOpt(M);
      return {
        vendorOptions: sortOpt(V),
        groupOptions: sortOpt(G),
        matOptions: allMats.filter((i) => !excludedMaterials.has(i.id)),
        excludeMatOptions: allMats,
        plantOptions: sortOpt(MV),
      };
    }, [rows, excludedMaterials]);

  // Main calculation runner
  const handleRun = useCallback(() => {
    if (!rows.length) return;
    if (!basisDate) {
      alert('Please select an aging basis date.');
      return;
    }
    const computed = runAging({
      movRows: rows,
      basisDateStr: basisDate,
      dateFromStr: dateFrom,
      dateToStr: dateTo,
      gb: groupBy,
      plants: selectedPlants,
      vendors: selectedVendors,
      groups: selectedGroups,
      materials: selectedMaterials,
      excluded: excludedMaterials,
      maxD: maxPostingSerial,
    });
    setReportResult(computed);
  }, [
    rows,
    basisDate,
    dateFrom,
    dateTo,
    groupBy,
    selectedPlants,
    selectedVendors,
    selectedGroups,
    selectedMaterials,
    excludedMaterials,
    maxPostingSerial,
    runAging,
  ]);

  // Save parsed data to backend (chunked — large MB51 JSON cannot go in one POST)
  const saveRowsToDatabase = async (fileName: string, parsedRows: Mb51AgingMovement[]) => {
    try {
      setLoading(true);
      setIsErrMsg(false);
      const meta = await saveMb51AgingRows(fileName, parsedRows, (saved, total) => {
        setLoadMsg(
          `Saving to database… ${saved.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')} rows`
        );
      });
      setLatestImport(meta);
      setLoadMsg('');
      setIsErrMsg(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Database save failed';
      console.error('[MB51 Save Error]', err);
      setLoadMsg(
        `Parsed file locally, but database save failed — data will be lost on reload. ${msg}`
      );
      setIsErrMsg(true);
    } finally {
      setLoading(false);
    }
  };

  // Build movement records from sheets
  const processSheets = useCallback(
    (wb: XLSX.WorkBook, sheetNames: string[], fileName: string) => {
      setLoadMsg('Processing sheet data…');
      setIsErrMsg(false);

      setTimeout(() => {
        try {
          const out: Mb51AgingMovement[] = [];
          const miss: string[] = [];
          let qtyCol = '';
          let uomCol = '';
          const uomSeen = new Map<string, number>();

          sheetNames.forEach((sn) => {
            const ws = wb.Sheets[sn];
            if (!ws) return;
            const data: unknown[][] = XLSX.utils.sheet_to_json(ws, {
              header: 1,
              raw: true,
              defval: '',
            });
            if (!data.length) return;

            const hdrRaw = data[0] as unknown[];
            const hdr = hdrRaw.map(norm);
            const ix: Record<string, number> = {};
            // Prefer alias order from COLS (Quantity before Qty in unit of entry)
            for (const k in COLS) {
              ix[k] = -1;
              for (const nm of COLS[k]) {
                const i = hdr.indexOf(nm);
                if (i >= 0) {
                  ix[k] = i;
                  break;
                }
              }
            }
            if (!qtyCol && ix.qty >= 0) qtyCol = String(hdrRaw[ix.qty] ?? '');
            if (!uomCol && ix.uom >= 0) uomCol = String(hdrRaw[ix.uom] ?? '');
            const need = ['date', 'mat', 'qty'].filter((k) => ix[k] < 0);
            if (need.length) {
              miss.push(`${sn}: ${need.join(', ')}`);
              return;
            }

            for (let r = 1; r < data.length; r++) {
              const row = data[r] as unknown[];
              const ds = toSerial(row[ix.date]);
              if (ds == null) continue;
              const q = Number(row[ix.qty]);
              if (isNaN(q)) continue;
              const uo = ix.uom >= 0 ? String(row[ix.uom] ?? '').trim() : '';
              uomSeen.set(uo, (uomSeen.get(uo) || 0) + 1);
              const sup = ix.sup >= 0 ? String(row[ix.sup] ?? '').trim() : '';
              const supn = ix.supn >= 0 ? String(row[ix.supn] ?? '').trim() : '';

              out.push({
                d: ds,
                q,
                m: String(row[ix.mat] ?? '').trim(),
                md: ix.desc >= 0 ? String(row[ix.desc] ?? '').trim() : '',
                g: ix.grp >= 0 ? String(row[ix.grp] ?? '').trim() : '',
                u: uo,
                v: sup,
                vn: supn,
                mv: ix.plant >= 0 ? String(row[ix.plant] ?? '').trim() : '',
                s: out.length,
                dc: ix.doc >= 0 ? String(row[ix.doc] ?? '').trim() : '',
                mt: ix.mov >= 0 ? String(row[ix.mov] ?? '').trim() : '',
                mtx: ix.movt >= 0 ? String(row[ix.movt] ?? '').trim() : '',
              });
            }
          });

          if (!out.length) {
            setLoadMsg(
              'No usable rows found.' + (miss.length ? ' Missing columns → ' + miss.join(' | ') : '')
            );
            setIsErrMsg(true);
            return;
          }

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
          setAvailableSheets([]);
          setWbInstance(null);

          initFromRows(out, 'vm');

          // Save to database
          saveRowsToDatabase(fileName, out);
        } catch (err: unknown) {
          console.error(err);
          const msg = err instanceof Error ? err.message : 'Error processing sheets';
          setLoadMsg(`Processing failed: ${msg}`);
          setIsErrMsg(true);
        }
      }, 30);
    },
    [initFromRows]
  );

  // File loading
  const handleFile = (f: File) => {
    setLoadMsg(`Reading ${f.name} … please wait`);
    setIsErrMsg(false);
    setAvailableSheets([]);

    const fr = new FileReader();
    fr.onerror = () => {
      setLoadMsg('Could not read the file.');
      setIsErrMsg(true);
    };
    fr.onload = () => {
      setTimeout(() => {
        try {
          const wb = XLSX.read(new Uint8Array(fr.result as ArrayBuffer), {
            type: 'array',
            cellDates: false,
            dense: true,
          });
          setWbInstance(wb);
          const names = wb.SheetNames;
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
          } else {
            processSheets(wb, names, f.name);
          }
        } catch (err: unknown) {
          console.error(err);
          const msg = err instanceof Error ? err.message : 'Failed to parse file';
          setLoadMsg(`Failed to parse: ${msg}`);
          setIsErrMsg(true);
        }
      }, 30);
    };
    fr.readAsArrayBuffer(f);
  };

  const handleResetFilters = () => {
    const codes = new Set(rows.map((r) => r.m).filter(Boolean));
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
    if (maxDateLimit) setDateTo(maxDateLimit);
    const today = new Date();
    const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    setBasisDate(todayIso);

    if (rows.length) {
      const computed = runAging({
        movRows: rows,
        basisDateStr: todayIso,
        dateFromStr: minDateLimit || '',
        dateToStr: maxDateLimit || '',
        gb: 'vm',
        plants: new Set(),
        vendors: new Set(),
        groups: new Set(),
        materials: new Set(),
        excluded: seedExcluded,
        maxD: maxPostingSerial,
      });
      setReportResult(computed);
    }
  };

  // Main Excel Export
  const exportXls = () => {
    if (!reportResult) return;
    const R = reportResult;
    const cols = HEAD[R.gb] || HEAD.vm;
    const q = searchQuery.trim().toLowerCase();
    let rws = R.rows;
    if (q) {
      rws = rws.filter((r) =>
        cols.some(([k]) => String(r[k] || '').toLowerCase().includes(q))
      );
    }

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

  // Filtered and sorted rows for main table
  const displayedRows = useMemo(() => {
    if (!reportResult) return [];
    const cols = HEAD[reportResult.gb] || HEAD.vm;
    const q = searchQuery.trim().toLowerCase();
    let list = reportResult.rows;

    if (q) {
      list = list.filter((r) =>
        cols.some(([k]) => String(r[k] || '').toLowerCase().includes(q))
      );
    }

    if (!sortKey) return list;

    return [...list].sort((x, y) => {
      let a: number | string = 0;
      let b: number | string = 0;
      if (sortKey === 'total') {
        a = x.total;
        b = y.total;
      } else if (sortKey === 'full') {
        a = x.full;
        b = y.full;
      } else if (sortKey.startsWith('b') && /^b\d$/.test(sortKey)) {
        const i = +sortKey[1] - 1;
        a = x.bk[i];
        b = y.bk[i];
      } else {
        a = String(x[sortKey] || '');
        b = String(y[sortKey] || '');
        return a.localeCompare(b, undefined, { numeric: true }) * sortDir;
      }
      return ((a as number) - (b as number)) * sortDir;
    });
  }, [reportResult, searchQuery, sortKey, sortDir]);

  // Sidebar width animates 300ms — thousands of <tr> reflow every frame and lag the UI.
  const PAGE_SIZE = 200;
  useEffect(() => {
    setPage(0);
  }, [reportResult, searchQuery, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(displayedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageFrom = displayedRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const pageTo = Math.min(displayedRows.length, (safePage + 1) * PAGE_SIZE);
  const shownRows = displayedRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const footerTotals = useMemo(() => {
    const bk = BUCKETS.map((_, i) =>
      displayedRows.reduce((s, r) => s + (r.bk[i] || 0), 0)
    );
    let total = 0;
    let full = 0;
    for (const r of displayedRows) {
      total += r.total;
      full += r.full;
    }
    return { bk, total, full };
  }, [displayedRows]);

  const gt = reportResult ? reportResult.tot.reduce((s, v) => s + v, 0) : 0;
  const currentCols = reportResult ? HEAD[reportResult.gb] || HEAD.vm : HEAD.vm;

  // Drill-down Collector matching MB51_Aging_Report.html
  const openDetail = (
    targetRows: Mb51AgingAggRow[],
    bucketIdx: number,
    title: string
  ) => {
    const out: [Mb51AgingMovement, number, number][] = [];
    targetRows.forEach((r) => {
      const items =
        bucketIdx < 0
          ? r.det.flat
            ? r.det.flat()
            : ([] as [Mb51AgingMovement, number, number][]).concat(...r.det)
          : r.det[bucketIdx] || [];
      items.forEach((x) => out.push(x));
    });
    out.sort(
      (x, y) => x[0].d - y[0].d || String(x[0].dc ?? '').localeCompare(String(y[0].dc ?? ''))
    );

    setModalNet(null);
    setModalLines(out);
    setModalTitle(title);
    setModalBucketIdx(bucketIdx);
    setModalOpen(true);
  };

  const openNet = (targetRows: Mb51AgingAggRow[], title: string) => {
    const seen = new Set<Mb51AgingMovement[]>();
    const L: { r: Mb51AgingMovement; pos: number; neg: number; net: number; n: number }[] = [];
    targetRows.forEach((r) =>
      r.fg.forEach(([a, full]) => {
        if (seen.has(a)) return;
        seen.add(a);
        let pos = 0,
          neg = 0;
        a.forEach((x) => {
          if (x.q > 0) pos += x.q;
          else neg += x.q;
        });
        L.push({ r: a[0], pos, neg, net: full, n: a.length });
      })
    );
    L.sort((x, y) => x.net - y.net);
    setModalLines([]);
    setModalNet(L);
    setModalTitle(title);
    setModalBucketIdx(-2);
    setModalOpen(true);
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
        serialToDMY(r.d),
        r.q || 0,
        q,
        age,
        BUCKETS[bucketOf(age)].l,
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [8, 12, 28, 12, 34, 12, 6, 14, 8, 22, 14, 12, 14, 10, 18].map((w) => ({
      wch: w,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Receipts');
    XLSX.writeFile(wb, 'MB51_Aging_Receipt_Detail.xlsx');
  };

  const rowTitle = (r: Mb51AgingAggRow) =>
    [r.a, r.b, r.d, r.e, r.c].filter(Boolean).join(' | ') || 'Total';

  return (
    <div className="mb51-app">
      <header>
        <div>
          <h1>MB51 Material Aging Report (FIFO)</h1>
          <div className="sub">
            Aging calculated on Posting Date &nbsp;|&nbsp; Portal Database Backed
            {latestImport?.importedAt && (
              <span> &bull; Saved: {new Date(latestImport.importedAt).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <div className="spacer" />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="btn" style={{ cursor: 'default' }}>
            Aging Report (FIFO)
          </span>
          <Link href="/report/mb51-table" className="btn sec" style={{ textDecoration: 'none' }}>
            Movements Table
          </Link>
          {rows.length > 0 && (
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
        {!loading && isErrMsg && loadMsg && !(showUpload && rows.length === 0) && (
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
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <b>Select or drop the MB51 export (.xlsx / .xls / .csv)</b>
              <div className="msg">
                Required columns: Posting Date, Material, Material Description, Material Group,
                Qty in unit of entry, Supplier, Supplier Name
              </div>
              <p>
                <input
                  type="file"
                  id="file"
                  accept=".xlsx,.xlsm,.xls,.csv"
                  disabled={loading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </p>

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
        {!loading && rows.length > 0 && (
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
                  />
                </div>
                <div className="f">
                  <label>Material group</label>
                  <MultiSelectDropdown
                    label="groups"
                    items={groupOptions}
                    selected={selectedGroups}
                    onChange={setSelectedGroups}
                  />
                </div>
                <div className="f">
                  <label>Material code - Material description</label>
                  <MultiSelectDropdown
                    label="materials"
                    items={matOptions}
                    selected={selectedMaterials}
                    onChange={setSelectedMaterials}
                  />
                </div>
                <div className="f">
                  <label>Exclude materials</label>
                  <MultiSelectDropdown
                    label="materials to exclude"
                    emptyText={`None excluded (${excludeMatOptions.length})`}
                    selectedOnlyLabel="Excluded only"
                    items={excludeMatOptions}
                    selected={excludedMaterials}
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
                      <div className="v">{fmtQty(val)}</div>
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
                    Result rows: <b>{displayedRows.length.toLocaleString('en-IN')}</b>
                  </span>
                  <span>
                    Stock as on {serialToDMY(reportResult.basis)}: <b>{fmtQty(gt)}</b>
                  </span>
                  <span>
                    Stock as per last updated on {serialToDMY(reportResult.maxD)}:{' '}
                    <b>{fmtQty(reportResult.fullTot)}</b>
                  </span>
                  {displayedRows.length > PAGE_SIZE && (
                    <span className="pager">
                      Showing{' '}
                      <b>
                        {pageFrom.toLocaleString('en-IN')}–{pageTo.toLocaleString('en-IN')}
                      </b>{' '}
                      of <b>{displayedRows.length.toLocaleString('en-IN')}</b>
                      <button
                        type="button"
                        className="btn sec"
                        disabled={safePage <= 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="btn sec"
                        disabled={safePage >= pageCount - 1}
                        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      >
                        Next
                      </button>
                    </span>
                  )}
                </div>
              )}

              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      {currentCols.map(([k, label]) => (
                        <th
                          key={k}
                          className={headColClass(k)}
                          onClick={() => {
                            if (sortKey === k) setSortDir((d) => -d);
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
                              if (sortKey === bkKey) setSortDir((d) => -d);
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
                          if (sortKey === 'total') setSortDir((d) => -d);
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
                          if (sortKey === 'full') setSortDir((d) => -d);
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
                          Grand total ({displayedRows.length.toLocaleString('en-IN')} rows)
                        </td>
                        {BUCKETS.map((_, i) => (
                          <td
                            key={i}
                            className="n bk click"
                            title="Click to see receipt details"
                            onClick={() =>
                              openDetail(displayedRows, i, 'All displayed rows')
                            }
                          >
                            {fmtQty(footerTotals.bk[i])}
                          </td>
                        ))}
                        <td
                          className="n click"
                          title="Click to see receipt details"
                          onClick={() =>
                            openDetail(displayedRows, -1, 'All displayed rows')
                          }
                        >
                          {fmtQty(footerTotals.total)}
                        </td>
                        <td
                          className="n tot2 click"
                          title="Click for net stock breakdown (all records)"
                          onClick={() => openNet(displayedRows, 'All displayed rows')}
                        >
                          {fmtQty(footerTotals.full)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

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
                  {displayedRows.length > PAGE_SIZE &&
                    ` Table shows ${PAGE_SIZE} rows per page for responsiveness – Export Excel contains all.`}
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
                      <td colSpan={7}>Total</td>
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
          /* Contain width so wide tables never scroll the whole portal page */
          max-width: 100%;
          overflow-x: hidden;
          min-width: 0;
        }
        .mb51-app * {
          box-sizing: border-box;
        }
        .mb51-app header {
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
        .mb51-app main {
          padding: 8px 12px;
          max-width: 100%;
          margin: 0 auto;
          overflow-x: hidden;
          min-width: 0;
        }
        .mb51-app #app {
          display: flex;
          flex-direction: column;
          gap: 0;
          min-width: 0;
          max-width: 100%;
        }
        .mb51-app .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 8px;
          min-width: 0;
          max-width: 100%;
        }
        .mb51-app .card.table-card {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          min-height: 0;
          margin-bottom: 0;
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
        .mb51-app .meta .pager {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-left: 4px;
        }
        .mb51-app .meta .pager .btn {
          height: 24px;
          padding: 0 8px;
          font-size: 11px;
        }
        /* Scroll lives on the table pane only — not the portal page */
        .mb51-app .tw {
          display: block;
          overflow-x: auto;
          overflow-y: auto;
          overscroll-behavior: contain;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          min-height: 220px;
          /* Give the grid most of the viewport after compact filters/KPIs */
          height: min(72vh, calc(100dvh - 260px));
          max-height: min(72vh, calc(100dvh - 260px));
          border: 1px solid var(--line);
          border-radius: 6px;
          /* Limit layout work when sidebar width animates */
          contain: inline-size layout;
          scrollbar-width: thin;
          scrollbar-color: #5f82a8 #e9eef4;
        }
        .mb51-app .tw::-webkit-scrollbar {
          width: 10px;
          height: 10px;
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
        /* Main report table only — modal keeps its own auto layout below */
        .mb51-app .tw table {
          border-collapse: separate;
          border-spacing: 0;
          width: max-content;
          min-width: 100%;
          table-layout: auto;
          font-variant-numeric: tabular-nums;
        }
        .mb51-app .tw th,
        .mb51-app .tw td {
          padding: 4px 6px;
          border-bottom: 1px solid #edf0f4;
          white-space: nowrap;
        }
        .mb51-app .tw th.clip,
        .mb51-app .tw td.clip {
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mb51-app .tw th.uom,
        .mb51-app .tw td.uom {
          text-align: center;
        }
        .mb51-app .tw th.bk {
          white-space: normal;
          line-height: 1.15;
          font-size: 10px;
          text-align: center;
          max-width: 4.25rem;
          padding-left: 3px;
          padding-right: 3px;
        }
        .mb51-app .tw td.bk {
          padding-left: 3px;
          padding-right: 3px;
        }
        .mb51-app .tw th.tot,
        .mb51-app .tw th.tot2 {
          white-space: normal;
          line-height: 1.2;
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
        .mb51-app .tw tbody tr {
          content-visibility: auto;
          contain-intrinsic-size: auto 28px;
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
