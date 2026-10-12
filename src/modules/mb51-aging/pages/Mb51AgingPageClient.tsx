'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import type {
  Mb51AgingMovement,
  Mb51AgingImportMeta,
  Mb51AgingBucket,
  Mb51AgingAggRow,
  Mb51AgingResult,
} from '@/modules/mb51-aging/types';

const BUCKETS: Mb51AgingBucket[] = [
  { k: 'b1', l: 'Below 30 days', min: 0, max: 30, c: 'var(--b1)' },
  { k: 'b2', l: '31 to 90 days', min: 31, max: 90, c: 'var(--b2)' },
  { k: 'b3', l: '91 to 180 days', min: 91, max: 180, c: 'var(--b3)' },
  { k: 'b4', l: '181 to 365 days', min: 181, max: 364, c: 'var(--b4)' },
  { k: 'b5', l: '1 year to 2 years', min: 365, max: 729, c: 'var(--b5)' },
  { k: 'b6', l: '2 to 3 years', min: 730, max: 1094, c: 'var(--b6)' },
  { k: 'b7', l: 'More than 3 years', min: 1095, max: 1e9, c: 'var(--b7)' },
];

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
  const s = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return v < 0 ? `(${s})` : s;
};

const norm = (s: unknown) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const COLS: Record<string, string[]> = {
  date: ['postingdate'],
  mat: ['material'],
  desc: ['materialdescription'],
  grp: ['materialgroup'],
  qty: ['qtyinunitofentry', 'quantity', 'qty'],
  sup: ['supplier', 'vendor'],
  supn: ['suppliername', 'vendorname'],
  uom: ['unitofentry', 'uom', 'baseunitofmeasure'],
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

function bucketOf(age: number): number {
  let i = 0;
  while (i < BUCKETS.length - 1 && age > BUCKETS[i].max) i++;
  return i;
}

type OptionItem = { id: string; text: string; lc: string };

function MultiSelectDropdown({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: OptionItem[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.lc.includes(q)) : items;
  }, [items, query]);

  const lim = 400;
  const part = shown.slice(0, lim);

  const buttonText = useMemo(() => {
    const n = selected.size;
    if (n === 0) return `All ${label} (${items.length})`;
    if (n === 1) {
      const match = items.find((i) => selected.has(i.id));
      return match ? match.text : '1 selected';
    }
    return `${n} selected`;
  }, [selected, label, items]);

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
              <div className="empty">No match</div>
            )}
          </div>
          <div className="ms-foot">
            {shown.length} of {items.length} shown
            {shown.length > lim ? ` (first ${lim} – refine search)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// Pure FIFO calculation helper
function computeFifoAging(opts: {
  rows: Mb51AgingMovement[];
  basisDateStr: string;
  dateFromStr: string;
  dateToStr: string;
  groupBy: 'mat' | 'vendor' | 'group' | 'vm';
  selectedPlants: Set<string>;
  selectedVendors: Set<string>;
  selectedGroups: Set<string>;
  selectedMaterials: Set<string>;
}): Mb51AgingResult | null {
  const {
    rows,
    basisDateStr,
    dateFromStr,
    dateToStr,
    groupBy,
    selectedPlants,
    selectedVendors,
    selectedGroups,
    selectedMaterials,
  } = opts;

  if (!rows.length) return null;
  const basis = dateToSerial(basisDateStr);
  if (basis == null) return null;
  const from = dateToSerial(dateFromStr) ?? -1e9;
  const to = dateToSerial(dateToStr) ?? 1e9;

  // Build index grouped by Plant + Vendor + Material + UoM
  const m = new Map<string, Mb51AgingMovement[]>();
  for (const r of rows) {
    const k = `${r.mv}|${r.v}|${r.m}|${r.u}`;
    let a = m.get(k);
    if (!a) {
      a = [];
      m.set(k, a);
    }
    a.push(r);
  }
  const groups = [...m.values()];
  groups.forEach((a) => a.sort((x, y) => x.d - y.d || x.s - y.s));

  const agg = new Map<string, Mb51AgingAggRow>();
  const tot = BUCKETS.map(() => 0);
  let layers = 0,
    negMat = 0,
    negQty = 0,
    plugged = 0,
    plugQty = 0,
    stockMat = 0;
  const EPS = 1e-6;

  for (const a of groups) {
    const f = a[0];
    if (selectedPlants.size && !selectedPlants.has(f.mv)) continue;
    if (selectedVendors.size && !selectedVendors.has(f.v)) continue;
    if (selectedGroups.size && !selectedGroups.has(f.g)) continue;
    if (selectedMaterials.size && !selectedMaterials.has(f.m)) continue;

    // Closing balance as on basis date (all postings up to basis date)
    let bal = 0;
    for (const r of a) {
      if (r.d > basis) break;
      bal += r.q;
    }
    if (bal <= EPS) {
      if (bal < -EPS) {
        negMat++;
        negQty += bal;
      }
      continue;
    }
    stockMat++;

    // FIFO: remaining stock = latest receipts -> walk receipts newest to oldest
    let rem = bal;
    const lay: [Mb51AgingMovement, number][] = [];
    for (let i = a.length - 1; i >= 0 && rem > EPS; i--) {
      const r = a[i];
      if (r.d > basis || r.q <= 0) continue;
      const take = Math.min(r.q, rem);
      rem -= take;
      lay.push([r, take]);
    }
    if (rem > EPS) {
      // Balance not covered by receipts in file -> treat as oldest stock
      const r = a[0];
      lay.push([
        {
          d: r.d,
          v: r.v,
          vn: r.vn,
          m: r.m,
          md: r.md,
          g: r.g,
          u: r.u,
          mv: r.mv,
          dc: '(balance not covered by receipts in file)',
          mt: '',
          mtx: '',
          q: rem,
          s: r.s,
        },
        rem,
      ]);
      plugged++;
      plugQty += rem;
    }

    for (const [r, q] of lay) {
      if (r.d < from || r.d > to) continue;
      const age = basis - r.d;
      let bi = 0;
      while (bi < BUCKETS.length - 1 && age > BUCKETS[bi].max) bi++;

      let key = '';
      let o: Partial<Mb51AgingAggRow> = {};
      switch (groupBy) {
        case 'vendor':
          key = `${r.v}|${r.u}`;
          o = { a: r.v, b: r.vn, c: '', d: '', u: r.u };
          break;
        case 'group':
          key = `${r.g}|${r.u}`;
          o = { a: '', b: '', c: r.g, d: '', u: r.u };
          break;
        case 'vm':
          key = `${r.v}|${r.m}|${r.u}`;
          o = { a: r.v, b: r.vn, c: r.g, d: r.m, e: r.md, u: r.u };
          break;
        default:
          key = `${r.m}|${r.u}`;
          o = { a: '', b: '', c: r.g, d: r.m, e: r.md, u: r.u };
      }

      let rec = agg.get(key);
      if (!rec) {
        rec = {
          bk: BUCKETS.map(() => 0),
          det: BUCKETS.map(() => []),
          total: 0,
          n: 0,
          ...o,
        };
        agg.set(key, rec);
      }
      rec.det[bi].push([r, q, age]);
      rec.bk[bi] += q;
      rec.total += q;
      rec.n++;
      tot[bi] += q;
      layers++;
    }
  }

  return {
    rows: [...agg.values()],
    tot,
    gb: groupBy,
    basis,
    from,
    to,
    used: layers,
    negMat,
    negQty,
    plugged,
    plugQty,
    stockMat,
  };
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

  // Default group by to 'vm' (Vendor + Material) as requested
  const [groupBy, setGroupBy] = useState<'mat' | 'vendor' | 'group' | 'vm'>('vm');

  // Filters state
  const [basisDate, setBasisDate] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [minDateLimit, setMinDateLimit] = useState<string>('');
  const [maxDateLimit, setMaxDateLimit] = useState<string>('');

  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [selectedPlants, setSelectedPlants] = useState<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<string>('total');
  const [sortDir, setSortDir] = useState<number>(-1);

  // Result state
  const [reportResult, setReportResult] = useState<Mb51AgingResult | null>(null);

  // Detail Drill-down Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalBucketIdx, setModalBucketIdx] = useState<number>(-1);
  const [modalLines, setModalLines] = useState<[Mb51AgingMovement, number, number][]>([]);

  // Function to initialize dates & report synchronously from a dataset
  const initFromRows = useCallback(
    (movRows: Mb51AgingMovement[], gb: 'mat' | 'vendor' | 'group' | 'vm' = 'vm') => {
      if (!movRows.length) return;
      let mn = 1e9,
        mx = -1e9;
      for (const r of movRows) {
        if (r.d < mn) mn = r.d;
        if (r.d > mx) mx = r.d;
      }
      const isoMn = serialToISO(mn);
      const isoMx = serialToISO(mx);
      const today = new Date();
      const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);

      setDateFrom(isoMn);
      setDateTo(isoMx);
      setMinDateLimit(isoMn);
      setMaxDateLimit(isoMx);
      setBasisDate(todayIso);
      setGroupBy(gb);

      const computed = computeFifoAging({
        rows: movRows,
        basisDateStr: todayIso,
        dateFromStr: isoMn,
        dateToStr: isoMx,
        groupBy: gb,
        selectedPlants: new Set(),
        selectedVendors: new Set(),
        selectedGroups: new Set(),
        selectedMaterials: new Set(),
      });

      setReportResult(computed);
      setRows(movRows);
      setShowUpload(false);
    },
    []
  );

  // Initial load from database
  useEffect(() => {
    let active = true;
    async function loadSavedData() {
      try {
        setLoading(true);
        setLoadMsg('Loading MB51 Aging Report from portal database…');
        const res = await fetch('/api/report/mb51-aging');
        if (!res.ok) {
          throw new Error(`Failed to load data (${res.status})`);
        }
        const data = await res.json();
        if (!active) return;

        if (data.rows && data.rows.length > 0) {
          setLatestImport(data.latestImport || null);
          setLoadMsg(
            `Loaded ${data.rows.length.toLocaleString('en-IN')} rows from database (${data.latestImport?.fileName ?? 'latest export'}).`
          );
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
  const { vendorOptions, groupOptions, matOptions, plantOptions } = useMemo(() => {
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

    return {
      vendorOptions: sortOpt(V),
      groupOptions: sortOpt(G),
      matOptions: sortOpt(M),
      plantOptions: sortOpt(MV),
    };
  }, [rows]);

  // Main calculation runner
  const handleRun = useCallback(() => {
    if (!rows.length) return;
    if (!basisDate) {
      alert('Please select an aging basis date.');
      return;
    }
    const computed = computeFifoAging({
      rows,
      basisDateStr: basisDate,
      dateFromStr: dateFrom,
      dateToStr: dateTo,
      groupBy,
      selectedPlants,
      selectedVendors,
      selectedGroups,
      selectedMaterials,
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
  ]);

  // Save parsed data to backend
  const saveRowsToDatabase = async (fileName: string, parsedRows: Mb51AgingMovement[]) => {
    try {
      setLoading(true);
      setLoadMsg(`Saving ${parsedRows.length.toLocaleString('en-IN')} rows to database…`);

      const res = await fetch('/api/report/mb51-aging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          rows: parsedRows,
          replaceExisting: true,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Save failed (${res.status})`);
      }

      const resData = await res.json();
      setLatestImport(resData.import);
      setLoadMsg(`Successfully saved ${parsedRows.length.toLocaleString('en-IN')} rows to database.`);
      setIsErrMsg(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Database save failed';
      console.error('[MB51 Save Error]', err);
      setLoadMsg(`Parsed file locally, but database save failed: ${msg}`);
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
          let _skipped = 0;

          sheetNames.forEach((sn) => {
            const ws = wb.Sheets[sn];
            if (!ws) return;
            const data: unknown[][] = XLSX.utils.sheet_to_json(ws, {
              header: 1,
              raw: true,
              defval: '',
            });
            if (!data.length) return;

            const hdr = (data[0] as unknown[]).map(norm);
            const ix: Record<string, number> = {};
            for (const k in COLS) {
              ix[k] = hdr.findIndex((h) => COLS[k].includes(h));
            }
            const need = ['date', 'mat', 'qty'].filter((k) => ix[k] < 0);
            if (need.length) {
              miss.push(`${sn}: ${need.join(', ')}`);
              return;
            }

            for (let r = 1; r < data.length; r++) {
              const row = data[r] as unknown[];
              const ds = toSerial(row[ix.date]);
              if (ds == null) {
                _skipped++;
                continue;
              }
              const q = Number(row[ix.qty]);
              if (isNaN(q)) {
                _skipped++;
                continue;
              }
              const sup = ix.sup >= 0 ? String(row[ix.sup] ?? '').trim() : '';
              const supn = ix.supn >= 0 ? String(row[ix.supn] ?? '').trim() : '';

              out.push({
                d: ds,
                q,
                m: String(row[ix.mat] ?? '').trim(),
                md: ix.desc >= 0 ? String(row[ix.desc] ?? '').trim() : '',
                g: ix.grp >= 0 ? String(row[ix.grp] ?? '').trim() : '',
                u: ix.uom >= 0 ? String(row[ix.uom] ?? '').trim() : '',
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

          setAvailableSheets([]);
          setWbInstance(null);

          // Initialize view with Vendor + Material default
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
    setSelectedVendors(new Set());
    setSelectedGroups(new Set());
    setSelectedMaterials(new Set());
    setSelectedPlants(new Set());
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
      const computed = computeFifoAging({
        rows,
        basisDateStr: todayIso,
        dateFromStr: minDateLimit || '',
        dateToStr: maxDateLimit || '',
        groupBy: 'vm',
        selectedPlants: new Set(),
        selectedVendors: new Set(),
        selectedGroups: new Set(),
        selectedMaterials: new Set(),
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
        'Receipt posting date from',
        R.from < -1e8 ? '' : serialToDMY(R.from),
        'to',
        R.to > 1e8 ? '' : serialToDMY(R.to),
      ],
      [],
      [...cols.map((c) => c[1]), ...BUCKETS.map((b) => b.l), 'Total'],
    ];

    rws.forEach((r) => {
      aoa.push([...cols.map(([k]) => String(r[k] ?? '')), ...r.bk, r.total]);
    });

    aoa.push([
      'Grand total',
      ...cols.slice(1).map(() => ''),
      ...BUCKETS.map((_, i) => rws.reduce((s, r) => s + r.bk[i], 0)),
      rws.reduce((s, r) => s + r.total, 0),
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      ...cols.map(([k]) => ({ wch: k === 'e' || k === 'b' ? 38 : 14 })),
      ...BUCKETS.map(() => ({ wch: 16 })),
      { wch: 14 },
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

    return [...list].sort((x, y) => {
      let a: number | string = 0;
      let b: number | string = 0;
      if (sortKey === 'total') {
        a = x.total;
        b = y.total;
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

  const MAXR = 3000;
  const shownRows = displayedRows.slice(0, MAXR);
  const gt = reportResult ? reportResult.tot.reduce((s, v) => s + v, 0) : 0;
  const currentCols = reportResult ? HEAD[reportResult.gb] || HEAD.vm : HEAD.vm;

  // Drill-down Collector matching line 436 in updated HTML
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

    setModalLines(out);
    setModalTitle(title);
    setModalBucketIdx(bucketIdx);
    setModalOpen(true);
  };

  // Export Excel for Drill-down modal
  const exportModalXls = () => {
    if (!modalLines.length || !reportResult) return;
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
        {/* Loading banner while reading DB */}
        {loading && (
          <div className="card" style={{ textAlign: 'center', padding: '24px' }}>
            <b style={{ fontSize: '15px' }}>{loadMsg}</b>
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
                  <label>Receipt posting date from</label>
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
                  <label>Receipt posting date to</label>
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

            {/* Meta and Table */}
            <div className="card">
              {reportResult && (
                <div className="meta">
                  <span>
                    Basis date: <b>{serialToDMY(reportResult.basis)}</b>
                  </span>
                  <span>
                    Receipt posting date:{' '}
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
                    Closing stock qty: <b>{fmtQty(gt)}</b>
                  </span>
                </div>
              )}

              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      {currentCols.map(([k, label]) => (
                        <th
                          key={k}
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
                        return (
                          <th
                            key={bkKey}
                            className="n"
                            onClick={() => {
                              if (sortKey === bkKey) setSortDir((d) => -d);
                              else {
                                setSortKey(bkKey);
                                setSortDir(-1);
                              }
                            }}
                          >
                            {b.l}
                            {sortKey === bkKey && (
                              <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>
                            )}
                          </th>
                        );
                      })}
                      <th
                        className="n tot"
                        onClick={() => {
                          if (sortKey === 'total') setSortDir((d) => -d);
                          else {
                            setSortKey('total');
                            setSortDir(-1);
                          }
                        }}
                      >
                        Total
                        {sortKey === 'total' && (
                          <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.length > 0 ? (
                      shownRows.map((r, rowIdx) => (
                        <tr key={rowIdx}>
                          {currentCols.map(([k]) => (
                            <td key={k}>{String(r[k] ?? '')}</td>
                          ))}
                          {r.bk.map((val, bIdx) => (
                            <td
                              key={bIdx}
                              className={`n ${val < 0 ? 'neg' : ''} ${
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
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={currentCols.length + BUCKETS.length + 1}
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
                        {BUCKETS.map((_, i) => {
                          const bucketSum = displayedRows.reduce(
                            (s, r) => s + (r.bk[i] || 0),
                            0
                          );
                          return (
                            <td
                              key={i}
                              className="n click"
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
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {reportResult && (
                <div className="note">
                  FIFO basis: closing balance (net qty of all postings up to the basis date)
                  per Plant + Vendor + Material is allocated to the latest receipts (positive qty),
                  because the oldest receipts are consumed first. Age = Basis date − receipt
                  Posting Date. Buckets: 0–29, 30–59, 60–179, 180–364, 365–729 (1–2 yr),
                  730–1094 (2–3 yr), 1095+ days (&gt;3 yr). Items with zero/negative balance are
                  excluded (no negative aging).
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
                  {displayedRows.length > MAXR &&
                    ` Showing first ${MAXR} rows on screen – Export Excel contains all.`}
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
                  {modalTitle} –{' '}
                  {modalBucketIdx < 0 ? 'All periods' : BUCKETS[modalBucketIdx]?.l}
                </div>
                <div id="mSub" className="msub">
                  Basis date <b>{reportResult ? serialToDMY(reportResult.basis) : '–'}</b>{' '}
                  &nbsp;|&nbsp; Receipt lines: <b>{modalLines.length}</b> &nbsp;|&nbsp;
                  Stock qty (FIFO allocated):{' '}
                  <b>{fmtQty(modalLines.reduce((s, x) => s + x[1], 0))}</b>
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
          min-height: 100vh;
        }
        .mb51-app * {
          box-sizing: border-box;
        }
        .mb51-app header {
          background: var(--brand-d);
          color: #fff;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .mb51-app header h1 {
          font-size: 18px;
          margin: 0;
          font-weight: 600;
        }
        .mb51-app header .sub {
          opacity: 0.75;
          font-size: 12px;
        }
        .mb51-app header .spacer {
          flex: 1;
        }
        .mb51-app main {
          padding: 14px 20px;
          max-width: 1800px;
          margin: 0 auto;
        }
        .mb51-app .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 12px 14px;
          margin-bottom: 12px;
        }
        .mb51-app .filters {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 12px 14px;
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
          height: 32px;
          border: 1px solid #c5cdd7;
          border-radius: 5px;
          padding: 0 8px;
          background: #fff;
          font: inherit;
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
          height: 32px;
          padding: 0 14px;
          border-radius: 5px;
          border: 1px solid var(--brand);
          background: var(--brand);
          color: #fff;
          font: inherit;
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
          top: 36px;
          left: 0;
          min-width: 100%;
          width: max(100%, 380px);
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
          grid-template-columns: repeat(7, minmax(120px, 1fr));
          gap: 10px;
        }
        .mb51-app .kpi {
          border: 1px solid var(--line);
          border-radius: 7px;
          padding: 8px 10px;
          background: #fff;
          border-top: 4px solid var(--c);
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
          font-size: 11px;
          color: var(--muted);
          font-weight: 600;
        }
        .mb51-app .kpi .v {
          font-size: 18px;
          font-weight: 700;
          margin-top: 2px;
          font-variant-numeric: tabular-nums;
        }
        .mb51-app .kpi .p {
          font-size: 11px;
          color: var(--muted);
        }
        .mb51-app .kpi .bar {
          height: 5px;
          background: #eef1f5;
          border-radius: 3px;
          margin-top: 5px;
          overflow: hidden;
        }
        .mb51-app .kpi .bar i {
          display: block;
          height: 100%;
          background: var(--c);
        }
        .mb51-app .meta {
          display: flex;
          gap: 18px;
          flex-wrap: wrap;
          color: var(--muted);
          font-size: 12px;
          margin-bottom: 8px;
        }
        .mb51-app .meta b {
          color: var(--ink);
        }
        .mb51-app .tw {
          overflow: auto;
          max-height: 68vh;
          border: 1px solid var(--line);
          border-radius: 6px;
        }
        .mb51-app table {
          border-collapse: separate;
          border-spacing: 0;
          width: 100%;
          font-variant-numeric: tabular-nums;
        }
        .mb51-app th,
        .mb51-app td {
          padding: 5px 9px;
          border-bottom: 1px solid #edf0f4;
          white-space: nowrap;
        }
        .mb51-app thead th {
          position: sticky;
          top: 0;
          background: #eaf0f7;
          z-index: 2;
          text-align: left;
          font-size: 12px;
          cursor: pointer;
          user-select: none;
          border-bottom: 2px solid #b9c7d8;
        }
        .mb51-app thead th.n {
          text-align: right;
        }
        .mb51-app thead th:hover {
          background: #dce7f4;
        }
        .mb51-app thead th .ar {
          opacity: 0.5;
          font-size: 10px;
          margin-left: 3px;
        }
        .mb51-app td.n {
          text-align: right;
        }
        .mb51-app td.neg {
          color: var(--neg);
        }
        .mb51-app td.z {
          color: #b6bfca;
        }
        .mb51-app tbody tr:hover td {
          background: #f3f8fe;
        }
        .mb51-app tfoot td {
          position: sticky;
          bottom: 0;
          background: #eaf0f7;
          font-weight: 700;
          border-top: 2px solid #b9c7d8;
        }
        .mb51-app td.tot,
        .mb51-app th.tot {
          background: #f6f9fc;
          font-weight: 700;
        }
        .mb51-app .empty {
          padding: 40px;
          text-align: center;
          color: var(--muted);
        }
        .mb51-app .note {
          font-size: 11px;
          color: var(--muted);
          margin-top: 8px;
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

        @media (max-width: 1100px) {
          .mb51-app .kpis {
            grid-template-columns: repeat(3, 1fr);
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
