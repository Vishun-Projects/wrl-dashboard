'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Package } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
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
  { key: 'partCode', label: 'Part code', tone: PART_TONE, head: PART_HEAD },
  { key: 'partName', label: 'Part', tone: PART_TONE, head: PART_HEAD },
  { key: 'qty', label: 'Qty', tone: PART_TONE, head: PART_HEAD },
  { key: 'newBarcode', label: 'New barcode', tone: PART_TONE, head: PART_HEAD },
  { key: 'oldBarcode', label: 'Old barcode', tone: PART_TONE, head: PART_HEAD },
  { key: 'remarks', label: 'Remarks', tone: PART_TONE, head: PART_HEAD },
];

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
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [options, setOptions] = useState<CallPartsOptions>({
    plants: [],
    branches: [],
    clients: [],
    engineers: [],
    statuses: [],
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
  }, [range, search, plant, branch, client, customer, engineer, status, part, sort, page]);

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
      title="Call Parts"
      subtitle={subtitle}
      icon={<Package className="h-4 w-4" />}
      toolbar={
        <div className="register-filter-bar register-filter-row-compact !px-2 !py-1">
          <div className="flex flex-wrap items-center gap-1.5 [&_.filter-select-root]:!min-w-[7.5rem] [&_.filter-select-root]:!max-w-[11rem] [&_.filter-select-root]:!flex-[0_1_9rem] [&_.register-filter-btn]:!h-6 [&_.register-filter-btn]:!px-1.5 [&_.register-filter-btn]:!text-[10px] [&_.register-filter-btn]:!shadow-none">
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
              className="h-6 w-32 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] text-slate-800 placeholder:text-slate-400"
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
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void exportCsv()}
          disabled={exporting || total === 0}
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {exporting ? 'Exporting…' : 'CSV'}
        </button>
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
            <AdminTable className="w-full min-w-[1100px] border-collapse text-left [&_td]:!px-1.5 [&_td]:!py-1 [&_td]:text-[11px] [&_td]:leading-snug">
              <AdminThead>
                <tr>
                  {COLUMNS.map((col) => (
                    <AdminTh
                      key={col.key}
                      className={`${col.head} !font-bold text-slate-800`}
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
              </AdminThead>
              <tbody>
                {loading ? (
                  <AdminTr>
                    <td className="px-3 py-3 text-[12px] text-slate-500" colSpan={20}>
                      Loading…
                    </td>
                  </AdminTr>
                ) : (
                  rows.map((r, i) => (
                    <PartRow
                      key={`${r.ncode}-${r.nofficeid}`}
                      row={r}
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

function PartRow({ row: r, groupStart }: { row: CallPartRow; groupStart: boolean }) {
  const edge = groupStart
    ? 'border-b border-slate-100 shadow-[inset_0_1px_0_0_#94a3b8]'
    : 'border-b border-slate-100';
  return (
    <AdminTr>
      <AdminTd className={`font-mono ${CALL_TONE} ${edge}`}>
        {r.callNo ? (
          <TrnLink trn={r.callNo} officeId={r.nofficeid} className="text-left font-mono text-blue-700 hover:underline" />
        ) : (
          '—'
        )}
      </AdminTd>
      <AdminTd className={`whitespace-nowrap ${CALL_TONE} ${edge}`}>{r.callLoggedAt ? formatUiDate(r.callLoggedAt) : '—'}</AdminTd>
      <Clip value={r.visitNo} width="max-w-[8.5rem]" mono tone={`${CALL_TONE} ${edge}`} />
      <AdminTd className={`whitespace-nowrap ${CALL_TONE} ${edge}`}>{r.visitAt ? formatUiDate(r.visitAt) : '—'}</AdminTd>
      <Clip value={shown(r.plantName)} width="max-w-[9rem]" tone={`${CALL_TONE} ${edge}`} />
      <Clip value={shown(r.branchName)} width="max-w-[9rem]" tone={`${CALL_TONE} ${edge}`} />
      <Clip value={shown(r.clientName)} width="max-w-[7rem]" tone={`${CALL_TONE} ${edge}`} />
      <Clip value={shown(r.partyName)} width="max-w-[8rem]" tone={`${CALL_TONE} ${edge}`} />
      <Clip value={r.city} width="max-w-[5rem]" tone={`${CALL_TONE} ${edge}`} />
      <AdminTd className={`${WORK_TONE} ${edge}`}>
        {r.statusLabel ? (
          <span className={`block max-w-[7rem] truncate font-medium ${statusTextClass(r.statusLabel)}`} title={r.statusLabel}>
            {r.statusLabel}
          </span>
        ) : (
          '—'
        )}
      </AdminTd>
      <Clip value={r.engineerName} width="max-w-[8rem]" tone={`${WORK_TONE} ${edge}`} />
      <Clip value={r.modelCode} width="max-w-[7rem]" mono tone={`${WORK_TONE} ${edge}`} />
      <Clip value={r.machineName} width="max-w-[10rem]" tone={`${WORK_TONE} ${edge}`} />
      <Clip value={r.barcode} width="max-w-[8rem]" mono tone={`${WORK_TONE} ${edge}`} />
      <Clip value={r.partCode} width="max-w-[6rem]" mono tone={`${PART_TONE} ${edge}`} />
      <Clip value={r.partName} width="max-w-[11rem]" tone={`${PART_TONE} ${edge}`} />
      <AdminTd className={`whitespace-nowrap ${PART_TONE} ${edge}`}>{qtyText(r.qty)}</AdminTd>
      <Clip value={r.newBarcode} width="max-w-[8rem]" mono tone={`${PART_TONE} ${edge}`} />
      <Clip value={r.oldBarcode} width="max-w-[8rem]" mono tone={`${PART_TONE} ${edge}`} />
      <Clip value={r.remarks} width="max-w-[9rem]" tone={`${PART_TONE} ${edge}`} />
    </AdminTr>
  );
}
