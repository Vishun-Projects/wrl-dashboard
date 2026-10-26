'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, Loader2, Package } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminTr } from '@/components/admin/AdminUi';
import { TrnLink } from '@/components/calls/TrnLink';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { formatUiDate, formatUiDateTime } from '@/lib/dates/ui-date';
import { feedback } from '@/lib/ui/feedback';
import { useTableSort } from '@/lib/ui/table-sort';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { defaultDateRange, toDateString, type ReportDateRange } from '@/modules/mis';
import type { CallPartRow, CallPartsOptions, CallPartsRowsResponse } from '@/modules/call-visits/types';

const API = '/api/report/call-visits';

type SortKey =
  | 'callNo'
  | 'visitNo'
  | 'visitAt'
  | 'callLoggedAt'
  | 'plantName'
  | 'branchName'
  | 'clientName'
  | 'partyName'
  | 'city'
  | 'statusLabel'
  | 'engineerName'
  | 'barcode'
  | 'machineName'
  | 'modelCode'
  | 'partCategory'
  | 'partCode'
  | 'partName'
  | 'qty'
  | 'oldBarcode'
  | 'newBarcode'
  | 'remarks';

function pickSingle(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

function buildParams(opts: {
  range: ReportDateRange;
  search: string;
  plant: string;
  branch: string;
  client: string;
  customer: string;
  engineer: string;
  status: string;
  part: string;
  category: string;
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
  page?: number;
  pageSize?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (opts.range.label === 'All Time') params.set('allTime', '1');
  else {
    params.set('startDate', toDateString(opts.range.start));
    params.set('endDate', toDateString(opts.range.end));
  }
  if (opts.search.trim()) params.set('search', opts.search.trim());
  if (opts.plant) params.set('plant', opts.plant);
  if (opts.branch) params.set('branch', opts.branch);
  if (opts.client) params.set('client', opts.client);
  if (opts.customer.trim()) params.set('customer', opts.customer.trim());
  if (opts.engineer) params.set('engineer', opts.engineer);
  if (opts.status) params.set('status', opts.status);
  if (opts.part.trim()) params.set('part', opts.part.trim());
  if (opts.category) params.set('category', opts.category);
  if (opts.sort) {
    params.set('sort', opts.sort.key);
    params.set('dir', opts.sort.dir);
  }
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  return params;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(text.replace(/\s+/g, ' ').trim().slice(0, 180) || `Request failed (${res.status})`);
  }
}

function shown(value: string | null): string {
  const text = value?.trim() ?? '';
  if (!text || text.toLowerCase() === 'unallocated') return '—';
  return text;
}

function Clip({
  value,
  width,
  mono,
  tone,
}: {
  value: string | null;
  width: string;
  mono?: boolean;
  tone: string;
}) {
  const text = value?.trim() ? value.trim() : '—';
  return (
    <AdminTd className={tone}>
      <span
        className={`block truncate ${width}${mono ? ' font-mono' : ''}`}
        title={text === '—' ? undefined : text}
      >
        {text}
      </span>
    </AdminTd>
  );
}

function qtyText(value: string | null): string {
  const text = value?.trim() ?? '';
  if (!text) return '—';
  const n = Number(text);
  return Number.isFinite(n) ? String(n) : text;
}

function statusTextClass(label: string): string {
  const s = label.trim().toLowerCase();
  if (s.includes('reject') || s.includes('cancel')) return 'text-rose-700';
  if (s.includes('tech') || s.includes('clos') || s.includes('solv')) return 'text-emerald-700';
  if (s.includes('assign')) return 'text-amber-700';
  if (s.includes('open')) return 'text-blue-700';
  return 'text-slate-600';
}

const CALL_TONE = 'bg-[#FFFFEB]';
const WORK_TONE = 'bg-[#FFF3FF]';
const PART_TONE = 'bg-[#E7F9F4]';
const CALL_HEAD = 'bg-[#E6E2B8]';
const PIN = 'sticky left-0 z-10 min-w-[7.25rem] border-r border-slate-300/80';
const HEAD_STICKY = 'sticky top-0 z-20';
const PIN_HEAD = 'sticky top-0 left-0 z-30 min-w-[7.25rem] border-r border-slate-400/70';
const WORK_HEAD = 'bg-[#E8C6EA]';
const PART_HEAD = 'bg-[#C5E6DC]';

const COLUMNS: Array<{ key: SortKey; label: string; tone: string; head: string }> = [
  { key: 'callNo', label: 'Call no', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'callLoggedAt', label: 'Call date', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'visitNo', label: 'Visit no', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'visitAt', label: 'Visit date', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'plantName', label: 'Branch', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'branchName', label: 'Franchisee', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'clientName', label: 'Client', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'partyName', label: 'Customer', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'city', label: 'City', tone: CALL_TONE, head: CALL_HEAD },
  { key: 'statusLabel', label: 'Status', tone: WORK_TONE, head: WORK_HEAD },
  { key: 'engineerName', label: 'Engineer', tone: WORK_TONE, head: WORK_HEAD },
  { key: 'modelCode', label: 'Model', tone: WORK_TONE, head: WORK_HEAD },
  { key: 'machineName', label: 'Description', tone: WORK_TONE, head: WORK_HEAD },
  { key: 'barcode', label: 'M/C Serial no.', tone: WORK_TONE, head: WORK_HEAD },
  { key: 'partCategory', label: 'Part category', tone: PART_TONE, head: PART_HEAD },
  { key: 'partCode', label: 'Part code', tone: PART_TONE, head: PART_HEAD },
  { key: 'partName', label: 'Part', tone: PART_TONE, head: PART_HEAD },
  { key: 'qty', label: 'Qty', tone: PART_TONE, head: PART_HEAD },
  { key: 'newBarcode', label: 'New barcode', tone: PART_TONE, head: PART_HEAD },
  { key: 'oldBarcode', label: 'Old barcode', tone: PART_TONE, head: PART_HEAD },
  { key: 'remarks', label: 'Remarks', tone: PART_TONE, head: PART_HEAD },
];

const COLUMN_KEYS = COLUMNS.map((col) => col.key);
const HIDDEN_COLUMNS_KEY = 'call_parts_hidden_columns';

function loadHiddenColumns(): SortKey[] {
  try {
    const raw = localStorage.getItem(HIDDEN_COLUMNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const hidden = parsed.filter((key): key is SortKey => COLUMN_KEYS.includes(key as SortKey));
    return hidden.length >= COLUMN_KEYS.length ? [] : hidden;
  } catch {
    return [];
  }
}

function ColumnPicker({
  hidden,
  onToggle,
}: {
  hidden: SortKey[];
  onToggle: (key: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const visibleCount = COLUMNS.length - hidden.length;
  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
        title="Show or hide columns"
        onClick={() => setOpen((value) => !value)}
      >
        <Columns3 className="h-3.5 w-3.5" />
        {hidden.length === 0 ? 'All columns' : `${visibleCount} columns`}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="custom-scrollbar max-h-64 overflow-y-auto p-1">
              {COLUMNS.map((col) => {
                const shown = !hidden.includes(col.key);
                return (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300"
                      checked={shown}
                      disabled={shown && visibleCount === 1}
                      onChange={() => onToggle(col.key)}
                    />
                    <span className={`text-[12px] ${shown ? 'font-medium text-slate-900' : 'text-slate-600'}`}>
                      {col.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function CallVisitsPageClient() {
  const [range, setRange] = useState<ReportDateRange>(() => defaultDateRange());
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [partInput, setPartInput] = useState('');
  const [part, setPart] = useState('');
  const [customerInput, setCustomerInput] = useState('');
  const [customer, setCustomer] = useState('');
  const [plant, setPlant] = useState('');
  const [branch, setBranch] = useState('');
  const [client, setClient] = useState('');
  const [engineer, setEngineer] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [options, setOptions] = useState<CallPartsOptions>({
    plants: [],
    branches: [],
    clients: [],
    engineers: [],
    statuses: [],
    categories: [],
  });
  const [data, setData] = useState<CallPartsRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const { sort, onSort } = useTableSort<SortKey>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
      setPart(partInput);
      setCustomer(customerInput);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, partInput, customerInput]);

  const plantOptions = useMemo<FilterSelectOption[]>(
    () => options.plants.map((b) => ({ value: b, label: b })),
    [options.plants]
  );
  const branchOptions = useMemo<FilterSelectOption[]>(
    () => options.branches.map((b) => ({ value: b, label: b })),
    [options.branches]
  );
  const clientOptions = useMemo<FilterSelectOption[]>(
    () => options.clients.map((b) => ({ value: b, label: b })),
    [options.clients]
  );
  const engineerOptions = useMemo<FilterSelectOption[]>(
    () => options.engineers.map((b) => ({ value: b, label: b })),
    [options.engineers]
  );
  const statusOptions = useMemo<FilterSelectOption[]>(
    () => options.statuses.map((b) => ({ value: b, label: b })),
    [options.statuses]
  );
  const categoryOptions = useMemo<FilterSelectOption[]>(
    () => (options.categories ?? []).map((b) => ({ value: b, label: b })),
    [options.categories]
  );
  const [hiddenColumns, setHiddenColumns] = useState<SortKey[]>([]);
  useEffect(() => {
    setHiddenColumns(loadHiddenColumns());
  }, []);
  const visibleColumns = useMemo(
    () => COLUMNS.filter((col) => !hiddenColumns.includes(col.key)),
    [hiddenColumns]
  );
  const toggleColumn = (key: SortKey) => {
    setHiddenColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      if (next.length >= COLUMN_KEYS.length) return prev;
      localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const filterArgs = {
    range,
    search,
    plant,
    branch,
    client,
    customer,
    engineer,
    status,
    part,
    category,
  };

  const loadOptions = useCallback(async () => {
    const params = buildParams({
      range,
      search: '',
      plant: '',
      branch: '',
      client: '',
      customer: '',
      engineer: '',
      status: '',
      part: '',
      category: '',
      sort: null,
    });
    params.set('mode', 'options');
    const res = await fetch(`${API}?${params.toString()}`, { credentials: 'include' });
    const body = await readJson(res);
    if (!res.ok) return;
    const list = (key: string) => (Array.isArray(body[key]) ? (body[key] as string[]) : []);
    setOptions({
      plants: list('plants'),
      branches: list('branches'),
      clients: list('clients'),
      engineers: list('engineers'),
      statuses: list('statuses'),
      categories: list('categories'),
    });
  }, [range]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams({ ...filterArgs, sort, page, pageSize });
      const res = await fetch(`${API}?${params.toString()}`, { credentials: 'include' });
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.error ?? 'Failed to load parts'));
      setData(body as unknown as CallPartsRowsResponse);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load parts');
    } finally {
      setLoading(false);
    }
  }, [range, search, plant, branch, client, customer, engineer, status, part, category, sort, page]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function exportCsv() {
    setExporting(true);
    try {
      const params = buildParams({ ...filterArgs, sort: null });
      params.set('format', 'csv');
      const res = await fetch(`${API}?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await readJson(res);
        throw new Error(String(body.error ?? 'CSV export failed'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `call-parts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'CSV export failed');
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const subtitle = data?.syncedAt
    ? `One row per part used on a call · last sync ${formatUiDateTime(data.syncedAt)}`
    : 'One row per part used on a call · sync has not run yet';

  return (
    <PageShell
      title="Parts Consumption as per CRM"
      subtitle={subtitle}
      icon={<Package className="h-4 w-4" />}
      toolbar={
        <div className="register-filter-bar register-filter-row-compact shrink-0 !px-2 !py-1">
          <div className="flex flex-wrap items-center gap-1.5 overflow-visible [&_.filter-select-root]:!min-w-[7.5rem] [&_.filter-select-root]:!max-w-[11rem] [&_.filter-select-root]:!shrink-0 [&_.filter-select-root]:!flex-[0_0_9rem] [&_.register-filter-btn]:!h-6 [&_.register-filter-btn]:!px-1.5 [&_.register-filter-btn]:!text-[10px] [&_.register-filter-btn]:!shadow-none">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => {
                setPage(1);
                setSearchInput(e.target.value);
              }}
              placeholder="Call no, part, or barcode…"
              aria-label="Search"
              className="h-6 w-44 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] text-slate-800 placeholder:text-slate-400"
            />
            <FilterSelect
              label="Branch"
              emptyLabel="All branches"
              options={plantOptions}
              selected={plant ? [plant] : []}
              mode="single"
              onChange={(values) => {
                setPage(1);
                setPlant(pickSingle(values));
              }}
              searchPlaceholder="Search branch…"
              panelClassName="w-72"
              layout="inline"
            />
            <FilterSelect
              label="Franchisee"
              emptyLabel="All franchisees"
              options={branchOptions}
              selected={branch ? [branch] : []}
              mode="single"
              onChange={(values) => {
                setPage(1);
                setBranch(pickSingle(values));
              }}
              searchPlaceholder="Search franchisee…"
              panelClassName="w-72"
              layout="inline"
            />
            <FilterSelect
              label="Client"
              emptyLabel="All clients"
              options={clientOptions}
              selected={client ? [client] : []}
              mode="single"
              onChange={(values) => {
                setPage(1);
                setClient(pickSingle(values));
              }}
              searchPlaceholder="Search client…"
              panelClassName="w-56"
              layout="inline"
            />
            <input
              type="search"
              value={customerInput}
              onChange={(e) => {
                setPage(1);
                setCustomerInput(e.target.value);
              }}
              placeholder="Customer contains…"
              aria-label="Customer contains"
              className="h-6 w-36 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] text-slate-800 placeholder:text-slate-400"
            />
            <FilterSelect
              label="Engineer"
              emptyLabel="All engineers"
              options={engineerOptions}
              selected={engineer ? [engineer] : []}
              mode="single"
              onChange={(values) => {
                setPage(1);
                setEngineer(pickSingle(values));
              }}
              searchPlaceholder="Search engineer…"
              panelClassName="w-64"
              layout="inline"
            />
            <FilterSelect
              label="Status"
              emptyLabel="All statuses"
              options={statusOptions}
              selected={status ? [status] : []}
              mode="single"
              onChange={(values) => {
                setPage(1);
                setStatus(pickSingle(values));
              }}
              searchPlaceholder="Search status…"
              panelClassName="w-56"
              layout="inline"
            />
            <input
              type="search"
              value={partInput}
              onChange={(e) => {
                setPage(1);
                setPartInput(e.target.value);
              }}
              placeholder="Part contains…"
              aria-label="Part contains"
              className="h-6 w-32 shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] text-slate-800 placeholder:text-slate-400"
            />
            <FilterSelect
              label="Part category"
              emptyLabel="All part categories"
              options={categoryOptions}
              selected={category ? [category] : []}
              mode="single"
              onChange={(values) => {
                setPage(1);
                setCategory(pickSingle(values));
              }}
              searchPlaceholder="Search category…"
              panelClassName="w-64"
              layout="inline"
            />
            <div className="min-w-[7.5rem] max-w-[10rem] shrink-0 [&_button]:!h-6 [&_button]:!px-1.5 [&_button]:!text-[10px] [&_button]:!shadow-none">
              <DateRangeSelector
                value={range.label}
                startDate={range.start}
                endDate={range.end}
                includeAllTime
                onChange={(next) => {
                  setPage(1);
                  setRange(next);
                }}
              />
            </div>
            <span className="ml-auto text-[10px] text-slate-500">
              {loading ? 'Loading…' : `${total.toLocaleString()} parts`}
            </span>
          </div>
        </div>
      }
      actions={
        <>
          <ColumnPicker hidden={hiddenColumns} onToggle={toggleColumn} />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void exportCsv()}
            disabled={exporting || total === 0}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {exporting ? 'Exporting…' : 'CSV'}
          </button>
        </>
      }
    >
      <PageScrollRegion>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <AdminTableCard
            isEmpty={!loading && rows.length === 0}
            empty={
              <p className="p-6 text-sm text-slate-500">
                {data?.syncedAt
                  ? 'No parts match the current filters.'
                  : 'No parts synced yet. The 2-hour sync fills this table from CRM.'}
              </p>
            }
          >
            <AdminTable className="w-full min-w-[1100px] border-separate border-spacing-0 text-left [&_td]:!px-1.5 [&_td]:!py-1 [&_td]:text-[11px] [&_td]:leading-snug">
              <thead>
                <tr>
                  {visibleColumns.map((col) => (
                    <AdminTh
                      key={col.key}
                      className={`${col.head} !font-bold text-slate-800 ${col.key === 'callNo' ? PIN_HEAD : HEAD_STICKY}`}
                      sortable
                      sortKey={col.key}
                      sort={sort}
                      onSort={(k) => {
                        setPage(1);
                        onSort(k as SortKey);
                      }}
                    >
                      {col.label}
                    </AdminTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <AdminTr>
                    <td className="px-3 py-3 text-[12px] text-slate-500" colSpan={visibleColumns.length}>
                      Loading…
                    </td>
                  </AdminTr>
                ) : (
                  rows.map((r, i) => (
                    <PartRow
                      key={`${r.ncode}-${r.nofficeid}`}
                      row={r}
                      columns={visibleColumns}
                      groupStart={i > 0 && r.callNo !== rows[i - 1]?.callNo}
                    />
                  ))
                )}
              </tbody>
            </AdminTable>
          </AdminTableCard>
          <div className="mt-3 flex items-center justify-between text-[12px] text-slate-600">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}

function PartRow({
  row: r,
  columns,
  groupStart,
}: {
  row: CallPartRow;
  columns: typeof COLUMNS;
  groupStart: boolean;
}) {
  const edge = groupStart
    ? 'border-b border-slate-100 shadow-[inset_0_1px_0_0_#94a3b8]'
    : 'border-b border-slate-100';
  return (
    <AdminTr>
      {columns.map((col) => (
        <PartCell key={col.key} col={col} row={r} edge={edge} />
      ))}
    </AdminTr>
  );
}

function PartCell({
  col,
  row: r,
  edge,
}: {
  col: (typeof COLUMNS)[number];
  row: CallPartRow;
  edge: string;
}) {
  const tone = `${col.tone} ${edge}`;
  switch (col.key) {
    case 'callNo':
      return (
        <AdminTd className={`font-mono ${tone} ${PIN}`}>
          {r.callNo ? (
            <TrnLink trn={r.callNo} officeId={r.nofficeid} className="text-left font-mono text-blue-700 hover:underline" />
          ) : (
            '—'
          )}
        </AdminTd>
      );
    case 'callLoggedAt':
      return <AdminTd className={`whitespace-nowrap ${tone}`}>{r.callLoggedAt ? formatUiDate(r.callLoggedAt) : '—'}</AdminTd>;
    case 'visitNo':
      return <Clip value={r.visitNo} width="max-w-[8.5rem]" mono tone={tone} />;
    case 'visitAt':
      return <AdminTd className={`whitespace-nowrap ${tone}`}>{r.visitAt ? formatUiDate(r.visitAt) : '—'}</AdminTd>;
    case 'plantName':
      return <Clip value={shown(r.plantName)} width="max-w-[9rem]" tone={tone} />;
    case 'branchName':
      return <Clip value={shown(r.branchName)} width="max-w-[9rem]" tone={tone} />;
    case 'clientName':
      return <Clip value={shown(r.clientName)} width="max-w-[7rem]" tone={tone} />;
    case 'partyName':
      return <Clip value={shown(r.partyName)} width="max-w-[8rem]" tone={tone} />;
    case 'city':
      return <Clip value={r.city} width="max-w-[5rem]" tone={tone} />;
    case 'statusLabel':
      return (
        <AdminTd className={tone}>
          {r.statusLabel ? (
            <span className={`block max-w-[7rem] truncate font-medium ${statusTextClass(r.statusLabel)}`} title={r.statusLabel}>
              {r.statusLabel}
            </span>
          ) : (
            '—'
          )}
        </AdminTd>
      );
    case 'engineerName':
      return <Clip value={r.engineerName} width="max-w-[8rem]" tone={tone} />;
    case 'modelCode':
      return <Clip value={r.modelCode} width="max-w-[7rem]" mono tone={tone} />;
    case 'machineName':
      return <Clip value={r.machineName} width="max-w-[10rem]" tone={tone} />;
    case 'barcode':
      return <Clip value={r.barcode} width="max-w-[8rem]" mono tone={tone} />;
    case 'partCategory':
      return <Clip value={r.partCategory} width="max-w-[8rem]" tone={tone} />;
    case 'partCode':
      return <Clip value={r.partCode} width="max-w-[6rem]" mono tone={tone} />;
    case 'partName':
      return <Clip value={r.partName} width="max-w-[11rem]" tone={tone} />;
    case 'qty':
      return <AdminTd className={`whitespace-nowrap ${tone}`}>{qtyText(r.qty)}</AdminTd>;
    case 'newBarcode':
      return <Clip value={r.newBarcode} width="max-w-[8rem]" mono tone={tone} />;
    case 'oldBarcode':
      return <Clip value={r.oldBarcode} width="max-w-[8rem]" mono tone={tone} />;
    case 'remarks':
      return <Clip value={r.remarks} width="max-w-[9rem]" tone={tone} />;
  }
}
