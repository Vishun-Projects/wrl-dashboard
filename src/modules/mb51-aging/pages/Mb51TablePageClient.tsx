'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import type { Mb51AgingImportMeta, Mb51AgingMovement } from '@/modules/mb51-aging/types';
import {
  fetchMb51Facets,
  fetchMb51Meta,
  fetchMb51MovementsPage,
} from '@/modules/mb51-aging/api-client';
import { saveMb51AgingRows } from '@/modules/mb51-aging/save-client';

const DAY = 86400000;
const EPOCH_OFFSET = 25569;

type MovementRow = {
  d: number;
  q: number;
  m: string;
  md: string;
  g: string;
  u: string;
  v: string;
  vn: string;
  mv: string;
  s: number;
  dc: string;
  mt: string;
  mtx: string;
  tx: string;
};

type OptionItem = { id: string; text: string; lc: string };
type SheetOption = { name: string; rowCount: number };

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
  const iso = serialToISO(n);
  if (!iso || iso.length < 10) return '–';
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
};

function toSerial(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / DAY + EPOCH_OFFSET);
  }

  const s = String(v).trim();
  // Supports DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY and ISO YYYY-MM-DD.
  let match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) / DAY + EPOCH_OFFSET;

  match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY + EPOCH_OFFSET;
  return null;
}

const fmtQty = (v: number): string => {
  if (v === 0 || Math.abs(v) < 1e-9) return '–';
  const formatted = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return v < 0 ? `(${formatted})` : formatted;
};

const norm = (s: unknown) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const asString = (value: unknown): string => (value == null ? '' : String(value).trim());
const asFiniteNumber = (value: unknown, fallback = 0): number => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * API/database rows can contain optional fields. Normalize them once so that
 * the table, filtering, sorting, and Excel export only work with defined values.
 */
function normalizeMovement(value: unknown, index: number): MovementRow {
  const row = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

  return {
    d: asFiniteNumber(row.d),
    q: asFiniteNumber(row.q),
    m: asString(row.m),
    md: asString(row.md),
    g: asString(row.g),
    u: asString(row.u),
    v: asString(row.v),
    vn: asString(row.vn),
    mv: asString(row.mv),
    s: asFiniteNumber(row.s, index),
    dc: asString(row.dc),
    mt: asString(row.mt),
    mtx: asString(row.mtx),
    tx: asString(row.tx),
  };
}

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
  text: ['text'],
  doc: ['materialdocument'],
  plant: ['plant'],
};

function MultiSelectDropdown({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: OptionItem[];
  selected: Set<string>;
  onChange: (selection: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popRef.current && !popRef.current.contains(event.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const shown = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? items.filter((item) => item.lc.includes(search)) : items;
  }, [items, query]);

  const limit = 400;
  const visibleItems = shown.slice(0, limit);

  const buttonText = useMemo(() => {
    const count = selected.size;
    if (count === 0) return `All ${label} (${items.length})`;
    if (count === 1) {
      const match = items.find((item) => selected.has(item.id));
      return match ? match.text : '1 selected';
    }
    return `${count} selected`;
  }, [selected, label, items]);

  return (
    <div className={`ms ${open ? 'open' : ''}`} ref={popRef}>
      <button type="button" className="ms-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="t">{buttonText}</span>
      </button>
      {open && (
        <div className="ms-pop">
          <div className="ms-top">
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                const next = new Set(selected);
                shown.forEach((item) => next.add(item.id));
                onChange(next);
              }}
            >
              All shown
            </button>
            <button type="button" onClick={() => onChange(new Set())}>Clear</button>
          </div>
          <div className="ms-list">
            {visibleItems.length > 0 ? (
              visibleItems.map((item) => (
                <label key={item.id} className="ms-item">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      onChange(next);
                    }}
                  />
                  <span>{item.text}</span>
                </label>
              ))
            ) : (
              <div className="empty">No match</div>
            )}
          </div>
          <div className="ms-foot">
            {shown.length} of {items.length} shown
            {shown.length > limit ? ` (first ${limit} – refine search)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Mb51TablePageClient() {
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [latestImport, setLatestImport] = useState<Mb51AgingImportMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState('Loading MB51 Movements Data from portal database…');
  const [isErrMsg, setIsErrMsg] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [wbInstance, setWbInstance] = useState<XLSX.WorkBook | null>(null);
  const [workbookFileName, setWorkbookFileName] = useState('MB51_Export.xlsx');
  const [availableSheets, setAvailableSheets] = useState<SheetOption[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minDateLimit, setMinDateLimit] = useState('');
  const [maxDateLimit, setMaxDateLimit] = useState('');
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [selectedPlants, setSelectedPlants] = useState<Set<string>>(new Set());
  const [selectedMovements, setSelectedMovements] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('s');
  const [sortDir, setSortDir] = useState(1);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pageLoading, setPageLoading] = useState(false);
  const [serverKpis, setServerKpis] = useState({
    filteredCount: 0,
    netQty: 0,
    receiptQty: 0,
    issueQty: 0,
    uniqueMaterials: 0,
    uniqueVendors: 0,
    uniquePlants: 0,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [facetVendors, setFacetVendors] = useState<OptionItem[]>([]);
  const [facetGroups, setFacetGroups] = useState<OptionItem[]>([]);
  const [facetMaterials, setFacetMaterials] = useState<OptionItem[]>([]);
  const [facetPlants, setFacetPlants] = useState<OptionItem[]>([]);
  const [facetMovements, setFacetMovements] = useState<OptionItem[]>([]);

  const initFromRows = useCallback((sourceRows: unknown[]) => {
    const normalizedRows = sourceRows.map((row, index) => normalizeMovement(row, index));
    if (!normalizedRows.length) return;

    let min = Infinity;
    let max = -Infinity;
    for (const row of normalizedRows) {
      if (row.d < min) min = row.d;
      if (row.d > max) max = row.d;
    }

    const minISO = serialToISO(min);
    const maxISO = serialToISO(max);
    setDateFrom(minISO);
    setDateTo(maxISO);
    setMinDateLimit(minISO);
    setMaxDateLimit(maxISO);
    setRows(normalizedRows);
    setShowUpload(false);
    setPage(1);
  }, []);

  const refreshMovements = useCallback(async () => {
    const fromSerial = dateToSerial(dateFrom);
    const toSerial = dateToSerial(dateTo);
    const data = await fetchMb51MovementsPage({
      offset: (page - 1) * pageSize,
      limit: pageSize,
      dateFrom: fromSerial,
      dateTo: toSerial,
      plants: [...selectedPlants],
      vendors: [...selectedVendors],
      groups: [...selectedGroups],
      materials: [...selectedMaterials],
      movements: [...selectedMovements],
      q: searchQuery,
    });
    setServerKpis(data.kpis);
    setTotalCount(data.totalCount);
    setRows(data.rows.map((r, idx) => normalizeMovement(r, (page - 1) * pageSize + idx)));
  }, [
    dateFrom,
    dateTo,
    page,
    pageSize,
    selectedPlants,
    selectedVendors,
    selectedGroups,
    selectedMaterials,
    selectedMovements,
    searchQuery,
  ]);

  useEffect(() => {
    let active = true;
    async function loadSavedData() {
      try {
        setLoading(true);
        setLoadMsg('Loading KPIs…');
        const meta = await fetchMb51Meta();
        if (!active) return;
        if (!meta.latestImport) {
          setLoadMsg('No saved data found in database. Please upload your MB51 export file.');
          setShowUpload(true);
          return;
        }
        setLatestImport(meta.latestImport);
        const mn = meta.latestImport.minPostingSerial ?? 0;
        const mx = meta.latestImport.maxPostingSerial ?? 0;
        const minISO = serialToISO(mn);
        const maxISO = serialToISO(mx);
        setDateFrom(minISO);
        setDateTo(maxISO);
        setMinDateLimit(minISO);
        setMaxDateLimit(maxISO);
        const facets = await fetchMb51Facets();
        if (!active) return;
        const toOpt = (xs: { id: string; text: string }[]) =>
          xs.map((x) => ({ id: x.id, text: x.text, lc: x.text.toLowerCase() }));
        setFacetVendors(toOpt(facets.vendors));
        setFacetGroups(toOpt(facets.groups));
        setFacetMaterials(toOpt(facets.materials));
        setFacetPlants(toOpt(facets.plants));
        setFacetMovements(toOpt(facets.movements));
        setShowUpload(false);
        setIsErrMsg(false);
        setLoadMsg('');
        setPage(1);
      } catch (error: unknown) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Failed to query database';
        setLoadMsg(message);
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

  useEffect(() => {
    setPage(1);
  }, [
    dateFrom,
    dateTo,
    selectedPlants,
    selectedVendors,
    selectedGroups,
    selectedMaterials,
    selectedMovements,
    searchQuery,
  ]);

  useEffect(() => {
    if (!latestImport) return;
    let active = true;
    void (async () => {
      try {
        // Keep table mounted on page flips; only full-screen load on first paint.
        setPageLoading(true);
        await refreshMovements();
        if (active) {
          setLoadMsg('');
          setIsErrMsg(false);
        }
      } catch (error: unknown) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Failed to load movements';
        setLoadMsg(message);
        setIsErrMsg(true);
      } finally {
        if (active) setPageLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    latestImport,
    dateFrom,
    dateTo,
    page,
    pageSize,
    selectedPlants,
    selectedVendors,
    selectedGroups,
    selectedMaterials,
    selectedMovements,
    searchQuery,
    refreshMovements,
  ]);

  const vendorOptions = facetVendors;
  const groupOptions = facetGroups;
  const matOptions = facetMaterials;
  const plantOptions = facetPlants;
  const movOptions = facetMovements;

  // Save imported rows to the database (chunked — same store as Aging report)
  const saveRowsToDatabase = useCallback(async (fileName: string, movementRows: MovementRow[]) => {
    try {
      setLoading(true);
      setIsErrMsg(false);
      const meta = await saveMb51AgingRows(
        fileName,
        movementRows as Mb51AgingMovement[],
        (saved, total) => {
          setLoadMsg(
            `Saving to database… ${saved.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')} rows`
          );
        }
      );
      setLatestImport(meta);
      setLoadMsg('Building aging snapshot…');
      const facets = await fetchMb51Facets();
      const toOpt = (xs: { id: string; text: string }[]) =>
        xs.map((x) => ({ id: x.id, text: x.text, lc: x.text.toLowerCase() }));
      setFacetVendors(toOpt(facets.vendors));
      setFacetGroups(toOpt(facets.groups));
      setFacetMaterials(toOpt(facets.materials));
      setFacetPlants(toOpt(facets.plants));
      setFacetMovements(toOpt(facets.movements));
      setPage(1);
      setLoadMsg(
        `Saved ${movementRows.length.toLocaleString('en-IN')} rows (${meta.fileName}).`
      );
      setIsErrMsg(false);
      setShowUpload(false);
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Database save failed';
      setLoadMsg(
        `Parsed file locally, but database save failed — data will be lost on reload. ${message}`
      );
      setIsErrMsg(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Parse selected workbook sheets
  const processSheets = useCallback(
    (workbook: XLSX.WorkBook, sheetNames: string[], fileName: string) => {
      setLoadMsg('Processing sheet data…');
      setIsErrMsg(false);

      window.setTimeout(() => {
        try {
          const output: MovementRow[] = [];
          const missingColumns: string[] = [];
          let skipped = 0;

          sheetNames.forEach((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) return;

            const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
              header: 1,
              raw: true,
              defval: '',
            });
            if (!data.length) return;

            const headers = (data[0] as unknown[]).map(norm);
            const indexes: Record<string, number> = {};
            for (const key in COLS) {
              indexes[key] = -1;
              for (const alias of COLS[key]) {
                const i = headers.indexOf(alias);
                if (i >= 0) {
                  indexes[key] = i;
                  break;
                }
              }
            }

            const required = ['date', 'mat', 'qty'].filter((key) => indexes[key] < 0);
            if (required.length) {
              missingColumns.push(`${sheetName}: ${required.join(', ')}`);
              return;
            }

            for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
              const sourceRow = data[rowIndex] as unknown[];
              const dateSerial = toSerial(sourceRow[indexes.date]);
              if (dateSerial == null) {
                skipped++;
                continue;
              }

              const quantityValue = Number(sourceRow[indexes.qty]);
              if (!Number.isFinite(quantityValue)) {
                skipped++;
                continue;
              }

              const supplier = indexes.sup >= 0 ? asString(sourceRow[indexes.sup]) : '';
              const supplierName = indexes.supn >= 0 ? asString(sourceRow[indexes.supn]) : '';
              output.push({
                d: dateSerial,
                q: quantityValue,
                m: indexes.mat >= 0 ? asString(sourceRow[indexes.mat]) : '',
                md: indexes.desc >= 0 ? asString(sourceRow[indexes.desc]) : '',
                g: indexes.grp >= 0 ? asString(sourceRow[indexes.grp]) : '',
                u: indexes.uom >= 0 ? asString(sourceRow[indexes.uom]) : '',
                v: supplier,
                vn: supplierName,
                mv: indexes.plant >= 0 ? asString(sourceRow[indexes.plant]) : '',
                s: output.length,
                dc: indexes.doc >= 0 ? asString(sourceRow[indexes.doc]) : '',
                mt: indexes.mov >= 0 ? asString(sourceRow[indexes.mov]) : '',
                mtx: indexes.movt >= 0 ? asString(sourceRow[indexes.movt]) : '',
                tx: indexes.text >= 0 ? asString(sourceRow[indexes.text]) : '',
              });
            }
          });

          if (!output.length) {
            setLoadMsg(
              'No usable rows found.' +
              (missingColumns.length ? ` Missing columns → ${missingColumns.join(' | ')}` : '') +
              (skipped ? ` Skipped ${skipped} invalid rows.` : ''),
            );
            setIsErrMsg(true);
            return;
          }

          setAvailableSheets([]);
          setSelectedSheets(new Set());
          setWbInstance(null);
          initFromRows(output);
          void saveRowsToDatabase(fileName, output);
          if (skipped) setLoadMsg(`Parsed ${output.length.toLocaleString('en-IN')} rows; skipped ${skipped} invalid rows. Saving to database…`);
        } catch (error: unknown) {
          console.error(error);
          const message = error instanceof Error ? error.message : 'Error processing sheets';
          setLoadMsg(`Processing failed: ${message}`);
          setIsErrMsg(true);
        }
      }, 30);
    },
    [initFromRows, saveRowsToDatabase],
  );

  // Read an Excel/CSV file in the browser
  const handleFile = (file: File) => {
    setWorkbookFileName(file.name);
    setLoadMsg(`Reading ${file.name} … please wait`);
    setIsErrMsg(false);
    setAvailableSheets([]);
    setSelectedSheets(new Set());

    const reader = new FileReader();
    reader.onload = (event) => {
      window.setTimeout(() => {
        try {
          const result = event.target?.result;
          if (!(result instanceof ArrayBuffer)) throw new Error('The selected file could not be read.');
          const workbook = XLSX.read(result, { type: 'array', cellDates: true, raw: true });
          setWbInstance(workbook);

          if (workbook.SheetNames.length === 1) {
            processSheets(workbook, workbook.SheetNames, file.name);
          } else if (workbook.SheetNames.length > 1) {
            const list: SheetOption[] = workbook.SheetNames.map((sheetName) => {
              const worksheet = workbook.Sheets[sheetName];
              const range = worksheet?.['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;
              return { name: sheetName, rowCount: range ? Math.max(0, range.e.r) : 0 };
            });
            setAvailableSheets(list);
            const defaultSelection = new Set<string>();
            const largest = list.find((sheet) => sheet.rowCount > 5);
            if (largest) defaultSelection.add(largest.name);
            else if (list[0]) defaultSelection.add(list[0].name);
            setSelectedSheets(defaultSelection);
            setLoadMsg(`Workbook contains ${list.length} sheets. Choose which ones to load:`);
          } else {
            setLoadMsg('The selected workbook contains no sheets.');
            setIsErrMsg(true);
          }
        } catch (error: unknown) {
          console.error(error);
          const message = error instanceof Error ? error.message : 'Failed to parse file';
          setLoadMsg(`Failed to parse: ${message}`);
          setIsErrMsg(true);
        }
      }, 30);
    };
    reader.onerror = () => {
      setLoadMsg(`Failed to read ${file.name}.`);
      setIsErrMsg(true);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleResetFilters = () => {
    setSelectedVendors(new Set());
    setSelectedGroups(new Set());
    setSelectedMaterials(new Set());
    setSelectedPlants(new Set());
    setSelectedMovements(new Set());
    setSearchQuery('');
    if (minDateLimit) setDateFrom(minDateLimit);
    if (maxDateLimit) setDateTo(maxDateLimit);
    setPage(1);
  };

  // Server returns the current page + KPIs for the active filter set
  const sortedRows = rows;
  const kpis = {
    totalCount,
    filteredCount: serverKpis.filteredCount,
    netQty: serverKpis.netQty,
    receiptQty: serverKpis.receiptQty,
    issueQty: serverKpis.issueQty,
    uniqueMaterials: serverKpis.uniqueMaterials,
    uniqueVendors: serverKpis.uniqueVendors,
    uniquePlants: serverKpis.uniquePlants,
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(kpis.filteredCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pagedRows = sortedRows;

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((direction) => -direction);
    else {
      setSortKey(key);
      setSortDir(key === 'q' || key === 'd' ? -1 : 1);
    }
  };

  const sortArrow = (key: string) =>
    sortKey === key ? <span className="ar">{sortDir > 0 ? ' ▲' : ' ▼'}</span> : null;

  // Excel export
  const exportXls = (all = false) => {
    const target = all ? rows : sortedRows;
    if (!target.length) return;

    const aoa: (string | number)[][] = [
      ['MB51 Material Movements Data'],
      ['Total exported rows', target.length, 'Posting date range', dateFrom || '–', 'to', dateTo || '–'],
      [],
      [
        'Seq #', 'Posting Date', 'Plant', 'Material Document', 'Movement Type', 'Movement Text', 'Text',
        'Material Code', 'Material Description', 'Material Group', 'Quantity', 'UoM', 'Vendor Code', 'Vendor Name',
      ],
    ];

    target.forEach((row, index) => {
      aoa.push([
        index + 1, serialToDMY(row.d), row.mv, row.dc, row.mt, row.mtx, row.tx, row.m, row.md, row.g,
        row.q, row.u, row.v, row.vn,
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet['!cols'] = [
      { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 18 },
      { wch: 16 }, { wch: 36 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 32 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Movements');
    XLSX.writeFile(workbook, all ? 'MB51_All_Movements.xlsx' : 'MB51_Filtered_Movements.xlsx');
  };

  return (
    <div className="mb51-root">
      <header>
        <div>
          <h1>MB51 Material Movements Data (Tabular)</h1>
          <div className="sub">
            All imported SAP MB51 material movement records&nbsp; | &nbsp;Portal Database Backed
            {latestImport?.importedAt && (
              <span>
                {' '}&bull; File: <b>{latestImport.fileName}</b> ({latestImport.rowCount.toLocaleString('en-IN')} records)
                {' '}&bull; Imported: {new Date(latestImport.importedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="spacer" />
        <div className="header-actions">
          <Link href="/report/mb51-aging" className="btn sec">Aging Report (FIFO)</Link>
          <span className="btn current-view">Movements Table</span>
          {rows.length > 0 && (
            <button type="button" className="btn sec" onClick={() => setShowUpload((visible) => !visible)}>
              {showUpload ? 'Back to table' : 'Load another file'}
            </button>
          )}
        </div>
      </header>

      <main>
        {(loading || (pageLoading && rows.length === 0)) && (
          <div className="card loading-card">
            <b>{loadMsg || 'Loading data…'}</b>
          </div>
        )}

        {!loading && loadMsg && !(showUpload && rows.length === 0) && (
          <div className={`card ${isErrMsg ? 'status-err' : 'status-ok'}`}>
            <div className={`msg ${isErrMsg ? 'err' : ''}`}>{loadMsg}</div>
          </div>
        )}

        {showUpload && (
          <div className="card" id="upCard">
            <div
              className={`drop ${isDragging ? 'over' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
            >
              <b>Select or drop the MB51 export (.xlsx / .xls / .csv)</b>
              <div className="msg">
                Required columns: Posting Date, Material, Qty in unit of entry. Supplier, description, group, plant and movement details are optional.
              </div>
              <p>
                <input
                  type="file"
                  id="file"
                  accept=".xlsx,.xlsm,.xls,.csv"
                  disabled={loading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleFile(file);
                    event.currentTarget.value = '';
                  }}
                />
              </p>

              {availableSheets.length > 0 && (
                <div className="sheets">
                  <div className="sheet-heading"><b>Sheets to include:</b></div>
                  {availableSheets.map((sheet) => (
                    <label key={sheet.name}>
                      <input
                        type="checkbox"
                        checked={selectedSheets.has(sheet.name)}
                        onChange={(event) => {
                          const next = new Set(selectedSheets);
                          if (event.target.checked) next.add(sheet.name);
                          else next.delete(sheet.name);
                          setSelectedSheets(next);
                        }}
                      />{' '}
                      {sheet.name} <small>({sheet.rowCount} rows)</small>
                    </label>
                  ))}
                  <div className="sheet-load">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (!selectedSheets.size) {
                          setLoadMsg('Select at least one sheet.');
                          setIsErrMsg(true);
                          return;
                        }
                        if (wbInstance) processSheets(wbInstance, [...selectedSheets], workbookFileName);
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

        {!loading && rows.length > 0 && (
          <div id="app">
            <div className="card">
              <div className="filters">
                <div className="f">
                  <label htmlFor="date-from">Posting date from</label>
                  <input id="date-from" type="date" value={dateFrom} min={minDateLimit} max={maxDateLimit}
                    onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} />
                </div>
                <div className="f">
                  <label htmlFor="date-to">Posting date to</label>
                  <input id="date-to" type="date" value={dateTo} min={minDateLimit} max={maxDateLimit}
                    onChange={(event) => { setDateTo(event.target.value); setPage(1); }} />
                </div>
                <div className="f">
                  <label>Vendor code - Vendor name</label>
                  <MultiSelectDropdown label="vendors" items={vendorOptions} selected={selectedVendors}
                    onChange={(selection) => { setSelectedVendors(selection); setPage(1); }} />
                </div>
                <div className="f">
                  <label>Material group</label>
                  <MultiSelectDropdown label="groups" items={groupOptions} selected={selectedGroups}
                    onChange={(selection) => { setSelectedGroups(selection); setPage(1); }} />
                </div>
                <div className="f">
                  <label>Material code - description</label>
                  <MultiSelectDropdown label="materials" items={matOptions} selected={selectedMaterials}
                    onChange={(selection) => { setSelectedMaterials(selection); setPage(1); }} />
                </div>
                <div className="f">
                  <label>Plant</label>
                  <MultiSelectDropdown label="plants" items={plantOptions} selected={selectedPlants}
                    onChange={(selection) => { setSelectedPlants(selection); setPage(1); }} />
                </div>
                <div className="f">
                  <label>Movement type</label>
                  <MultiSelectDropdown label="movement types" items={movOptions} selected={selectedMovements}
                    onChange={(selection) => { setSelectedMovements(selection); setPage(1); }} />
                </div>
                <div className="f">
                  <label htmlFor="table-search">Search in table</label>
                  <input id="table-search" type="text" placeholder="Search material, doc, vendor, plant, text…" value={searchQuery}
                    onChange={(event) => { setSearchQuery(event.target.value); setPage(1); }} />
                </div>
                <div className="actions">
                  <button type="button" className="btn sec" onClick={handleResetFilters}>Reset</button>
                  <button type="button" className="btn sec" onClick={() => exportXls(false)}>Export View</button>
                  <button type="button" className="btn" onClick={() => exportXls(true)}>Export All</button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="kpis">
                <div className="kpi" style={{ '--c': '#0b5cab' } as React.CSSProperties}>
                  <div className="l">Filtered Rows</div>
                  <div className="v">{kpis.filteredCount.toLocaleString('en-IN')}</div>
                  <div className="p">{((kpis.filteredCount / Math.max(1, kpis.totalCount)) * 100).toFixed(1)}% of {kpis.totalCount.toLocaleString('en-IN')}</div>
                </div>
                <div className="kpi" style={{ '--c': '#1e8e5a' } as React.CSSProperties}>
                  <div className="l">Net Quantity</div><div className="v">{fmtQty(kpis.netQty)}</div><div className="p">Balance in filtered scope</div>
                </div>
                <div className="kpi" style={{ '--c': '#2e9e6b' } as React.CSSProperties}>
                  <div className="l">Receipts Qty (+)</div><div className="v">{fmtQty(kpis.receiptQty)}</div><div className="p">Total incoming stock</div>
                </div>
                <div className="kpi" style={{ '--c': '#c0392b' } as React.CSSProperties}>
                  <div className="l">Issues Qty (−)</div><div className="v" style={{ color: 'var(--neg)' }}>{fmtQty(kpis.issueQty)}</div><div className="p">Total issued/consumed</div>
                </div>
                <div className="kpi" style={{ '--c': '#f2b01e' } as React.CSSProperties}>
                  <div className="l">Distinct Materials</div><div className="v">{kpis.uniqueMaterials.toLocaleString('en-IN')}</div><div className="p">In current view</div>
                </div>
                <div className="kpi" style={{ '--c': '#7cb342' } as React.CSSProperties}>
                  <div className="l">Distinct Vendors</div><div className="v">{kpis.uniqueVendors.toLocaleString('en-IN')}</div><div className="p">In current view</div>
                </div>
                <div className="kpi" style={{ '--c': '#8e1f2f' } as React.CSSProperties}>
                  <div className="l">Distinct Plants</div><div className="v">{kpis.uniquePlants.toLocaleString('en-IN')}</div><div className="p">In current view</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="meta table-meta">
                <div className="meta-left">
                  <span>
                    {pageLoading
                      ? `Loading page ${currentPage} of ${totalPages}…`
                      : <>Showing <b>{(sortedRows.length ? (currentPage - 1) * pageSize + 1 : 0).toLocaleString('en-IN')}</b> to{' '}
                    <b>{Math.min(currentPage * pageSize, kpis.filteredCount).toLocaleString('en-IN')}</b> of{' '}
                    <b>{kpis.filteredCount.toLocaleString('en-IN')}</b> movements</>}
                  </span>
                  <span>Net Qty: <b>{fmtQty(kpis.netQty)}</b></span>
                </div>
                <div className="page-size-control">
                  <label htmlFor="page-size">Page size:</label>
                  <select id="page-size" value={pageSize} disabled={pageLoading} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                    <option value={50}>50</option><option value={100}>100</option><option value={250}>250</option>
                    <option value={500}>500</option><option value={1000}>1000</option>
                  </select>
                </div>
              </div>

              {pageLoading && (
                <div className="page-loading" role="status" aria-live="polite">
                  Loading data…
                </div>
              )}
              <div className={`tw${pageLoading ? ' is-paging' : ''}`} aria-busy={pageLoading}>
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('s')}># {sortArrow('s')}</th>
                      <th onClick={() => handleSort('d')}>Posting Date {sortArrow('d')}</th>
                      <th onClick={() => handleSort('mv')}>Plant {sortArrow('mv')}</th>
                      <th onClick={() => handleSort('dc')}>Material Doc {sortArrow('dc')}</th>
                      <th onClick={() => handleSort('mt')}>Mov. Type {sortArrow('mt')}</th>
                      <th onClick={() => handleSort('mtx')}>Movement Text {sortArrow('mtx')}</th>
                      <th onClick={() => handleSort('tx')}>Text {sortArrow('tx')}</th>
                      <th onClick={() => handleSort('m')}>Material {sortArrow('m')}</th>
                      <th onClick={() => handleSort('md')}>Description {sortArrow('md')}</th>
                      <th onClick={() => handleSort('g')}>Group {sortArrow('g')}</th>
                      <th className="n" onClick={() => handleSort('q')}>Quantity {sortArrow('q')}</th>
                      <th>UoM</th>
                      <th onClick={() => handleSort('v')}>Vendor {sortArrow('v')}</th>
                      <th onClick={() => handleSort('vn')}>Vendor Name {sortArrow('vn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.length > 0 ? pagedRows.map((row, index) => (
                      <tr key={`${row.s}-${index}`}>
                        <td className="row-number">{((currentPage - 1) * pageSize + index + 1).toLocaleString('en-IN')}</td>
                        <td>{serialToDMY(row.d)}</td>
                        <td><b>{row.mv}</b></td>
                        <td className="document-number">{row.dc}</td>
                        <td><span className="badge">{row.mt}</span></td>
                        <td className="truncate movement-text" title={row.mtx}>{row.mtx}</td>
                        <td className="truncate item-text" title={row.tx}>{row.tx}</td>
                        <td><b className="material-code">{row.m}</b></td>
                        <td className="truncate description-text" title={row.md}>{row.md}</td>
                        <td>{row.g}</td>
                        <td className={`n ${row.q < 0 ? 'neg' : ''}`}>{fmtQty(row.q)}</td>
                        <td>{row.u}</td>
                        <td>{row.v}</td>
                        <td className="truncate vendor-name" title={row.vn}>{row.vn}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={14} className="empty">No movements match the selected filters.</td></tr>
                    )}
                  </tbody>
                  {pagedRows.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={10}>Total Filtered ({sortedRows.length.toLocaleString('en-IN')} rows)</td>
                        <td className="n">{fmtQty(kpis.netQty)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <div className="pagination">
                <div className="pagination-info">
                  {pageLoading
                    ? <>Loading page <b>{currentPage}</b> of <b>{totalPages}</b>…</>
                    : <>Page <b>{currentPage}</b> of <b>{totalPages}</b> ({kpis.filteredCount.toLocaleString('en-IN')} records)</>}
                </div>
                <div className="pagination-actions">
                  <button type="button" className="btn sec page-btn" disabled={pageLoading || currentPage <= 1} onClick={() => setPage(1)}>« First</button>
                  <button type="button" className="btn sec page-btn" disabled={pageLoading || currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹ Prev</button>
                  <span className="page-indicator">{currentPage} / {totalPages}</span>
                  <button type="button" className="btn sec page-btn" disabled={pageLoading || currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next ›</button>
                  <button type="button" className="btn sec page-btn" disabled={pageLoading || currentPage >= totalPages} onClick={() => setPage(totalPages)}>Last »</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        .mb51-root {
          --bg: #f4f6f9; --card: #fff; --ink: #1c2733; --muted: #64748b;
          --line: #dde3ea; --brand: #0b5cab; --brand-d: #084580; --accent: #e8f1fb;
          --neg: #c0392b; --ok: #1e8e5a;
          margin: 0; font: 13px/1.4 'Segoe UI', Roboto, Arial, sans-serif;
          background: var(--bg); color: var(--ink); min-height: 100vh;
        }
        header { background: var(--brand-d); color: #fff; padding: 12px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        header h1 { font-size: 18px; margin: 0; font-weight: 600; }
        header .sub { opacity: .8; font-size: 12px; }
        header .spacer { flex: 1; }
        .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        main { padding: 14px 20px; max-width: 1800px; margin: 0 auto; }
        .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
        .loading-card { text-align: center; padding: 24px; }
        .page-loading {
          padding: 6px 10px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #1d4f7a;
          background: #eef5fb;
          border: 1px solid #c5d8ea;
          border-radius: 6px;
        }
        .tw.is-paging { opacity: 0.45; pointer-events: none; }
        .filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px 14px; align-items: end; }
        .f label { display: block; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
        input[type='date'], select, .ms-btn, input[type='text'] { width: 100%; height: 32px; border: 1px solid #c5cdd7; border-radius: 5px; padding: 0 8px; background: #fff; font: inherit; color: var(--ink); }
        input:focus, select:focus, .ms-btn:focus { outline: 2px solid #86b6e8; outline-offset: 0; }
        .btn { white-space: nowrap; min-height: 32px; padding: 0 14px; border-radius: 5px; border: 1px solid var(--brand); background: var(--brand); color: #fff; font: inherit; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
        .btn:hover { background: var(--brand-d); }
        .btn.sec { background: #fff; color: var(--brand); }
        .btn.sec:hover { background: var(--accent); }
        .btn[disabled] { opacity: .5; cursor: not-allowed; }
        .current-view { cursor: default; }
        .current-view:hover { background: var(--brand); }
        .page-btn { min-height: 28px; padding: 0 10px; font-size: 12px; }
        .actions { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
        .badge { display: inline-block; background: #eef4fb; color: #0b5cab; border: 1px solid #cfe0f5; border-radius: 4px; padding: 1px 6px; font-weight: 600; font-size: 11px; }
        .ms { position: relative; }
        .ms-btn { text-align: left; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .ms-btn span.t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ms-btn::after { content: '▾'; color: var(--muted); }
        .ms-pop { position: absolute; z-index: 30; top: 36px; left: 0; min-width: 100%; width: max(100%, 380px); max-width: min(480px, 90vw); background: #fff; border: 1px solid #b7c2cf; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
        .ms-top { padding: 6px; border-bottom: 1px solid var(--line); display: flex; gap: 6px; }
        .ms-top input { flex: 1; min-width: 70px; }
        .ms-top button { border: 1px solid #c5cdd7; background: #f7f9fb; border-radius: 5px; padding: 0 8px; cursor: pointer; font: inherit; font-size: 11px; }
        .ms-list { max-height: 260px; overflow: auto; }
        .ms-item { display: flex; gap: 8px; align-items: center; padding: 4px 10px; cursor: pointer; }
        .ms-item:hover { background: var(--accent); }
        .ms-item input { margin: 0; }
        .ms-foot { padding: 4px 10px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); }
        .drop { border: 2px dashed #9db4cc; border-radius: 8px; padding: 28px; text-align: center; background: #fafcfe; }
        .drop.over { background: var(--accent); border-color: var(--brand); }
        .drop > b { font-size: 15px; }
        .sheets { display: flex; gap: 10px 14px; flex-wrap: wrap; margin-top: 10px; justify-content: center; align-items: center; }
        .sheet-heading, .sheet-load { width: 100%; }
        .sheet-load { margin-top: 8px; }
        .sheets label { display: inline-flex; align-items: center; gap: 4px; }
        .msg { margin-top: 8px; color: var(--muted); }
        .err { color: var(--neg); }
        .status-ok { background: #f3faf6; }
        .status-err { background: #fdf2f1; border-color: var(--neg); }
        .status-ok .msg, .status-err .msg { margin-top: 0; }
        .kpis { display: grid; grid-template-columns: repeat(7, minmax(120px, 1fr)); gap: 10px; }
        .kpi { min-width: 0; border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px; background: #fff; border-top: 4px solid var(--c); }
        .kpi .l { font-size: 11px; color: var(--muted); font-weight: 600; }
        .kpi .v { font-size: 18px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .kpi .p { font-size: 11px; color: var(--muted); }
        .meta { display: flex; gap: 18px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin-bottom: 8px; }
        .meta b { color: var(--ink); }
        .table-meta { justify-content: space-between; align-items: center; }
        .meta-left, .page-size-control { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
        .page-size-control { gap: 10px; }
        .page-size-control label { font-size: 12px; font-weight: 600; }
        .page-size-control select { width: 80px; height: 28px; }
        .tw { overflow: auto; max-height: 68vh; border: 1px solid var(--line); border-radius: 6px; }
        table { border-collapse: separate; border-spacing: 0; width: 100%; font-variant-numeric: tabular-nums; }
        th, td { padding: 5px 9px; border-bottom: 1px solid #edf0f4; white-space: nowrap; }
        thead th { position: sticky; top: 0; background: #eaf0f7; z-index: 2; text-align: left; font-size: 12px; cursor: pointer; user-select: none; border-bottom: 2px solid #b9c7d8; }
        thead th.n { text-align: right; }
        thead th:hover { background: #dce7f4; }
        thead th .ar { opacity: .7; font-size: 10px; margin-left: 3px; }
        td.n { text-align: right; font-weight: 600; }
        td.neg { color: var(--neg); }
        tbody tr:hover td { background: #f3f8fe; }
        tfoot td { position: sticky; bottom: 0; background: #eaf0f7; font-weight: 700; border-top: 2px solid #b9c7d8; }
        .row-number { color: var(--muted); font-size: 11px; }
        .document-number { font-family: monospace; font-size: 12px; }
        .material-code { color: var(--brand); }
        .truncate { overflow: hidden; text-overflow: ellipsis; }
        .movement-text { max-width: 220px; }
        .item-text { max-width: 160px; }
        .description-text { max-width: 320px; }
        .vendor-name { max-width: 240px; }
        .empty { padding: 40px; text-align: center; color: var(--muted); }
        .pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; flex-wrap: wrap; gap: 8px; }
        .pagination-info { font-size: 12px; color: var(--muted); }
        .pagination-actions { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
        .page-indicator { padding: 0 8px; font-size: 12px; font-weight: 600; }
        @media (max-width: 1400px) { .kpis { grid-template-columns: repeat(4, minmax(120px, 1fr)); } }
        @media (max-width: 900px) { main { padding: 10px; } header { padding: 12px; } .kpis { grid-template-columns: repeat(2, minmax(120px, 1fr)); } .filters { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); } }
        @media (max-width: 520px) { .kpis { grid-template-columns: 1fr 1fr; } .meta-left { gap: 8px; } .drop { padding: 18px 10px; } .ms-pop { width: min(380px, 90vw); } }
      `}</style>
    </div>
  );
}
