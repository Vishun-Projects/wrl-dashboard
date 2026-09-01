'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Ban, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { formatUiDate, formatUiDateTime } from '@/lib/dates/ui-date';
import { feedback } from '@/lib/ui/feedback';
import type {
  CancelledCallRow,
  CancelledCallsFranchiseeOption,
  CancelledCallsRowsResponse,
  CancelledCallsSummary,
} from '@/modules/cancelled-calls/types';
import { formatCancelledCallFranchisee } from '@/modules/cancelled-calls/franchisee-label';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import { RegisterMultiSelect } from '@/modules/mis/register/components/RegisterMultiSelect';
import type { RegisterMultiSelectOption } from '@/modules/mis/register/components/RegisterMultiSelect';
import { defaultDateRange, toDateString, type ReportDateRange } from '@/modules/mis';

const API = '/api/report/cancelled-calls';

function buildParams(opts: {
  startDate: string;
  endDate: string;
  branches: string[];
  franchisees: string[];
  partyProfiles: string[];
  callTypes: string[];
  page?: number;
  pageSize?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('startDate', opts.startDate);
  params.set('endDate', opts.endDate);
  if (opts.branches.length) params.set('branches', opts.branches.join(','));
  if (opts.franchisees.length) params.set('franchisees', opts.franchisees.join(','));
  if (opts.partyProfiles.length) params.set('partyProfiles', opts.partyProfiles.join(','));
  if (opts.callTypes.length) params.set('callTypes', opts.callTypes.join(','));
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  return params;
}

function pickSingleFilterValue(values: string[]): string {
  if (values.length === 0) return '';
  return values[values.length - 1] ?? '';
}

export default function CancelledCallsPageClient() {
  const [dateRange, setDateRange] = useState<ReportDateRange>(() => defaultDateRange());
  const startDate = useMemo(() => toDateString(dateRange.start), [dateRange.start]);
  const endDate = useMemo(() => toDateString(dateRange.end), [dateRange.end]);
  const [branch, setBranch] = useState('');
  const [franchisee, setFranchisee] = useState('');
  const [partyProfile, setPartyProfile] = useState('');
  const [callType, setCallType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [franchiseeOptions, setFranchiseeOptions] = useState<CancelledCallsFranchiseeOption[]>([]);
  const [partyProfileOptions, setPartyProfileOptions] = useState<string[]>([]);
  const [callTypeOptions, setCallTypeOptions] = useState<string[]>([]);
  const [summary, setSummary] = useState<CancelledCallsSummary | null>(null);
  const [rowsData, setRowsData] = useState<CancelledCallsRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const branches = branch ? [branch] : [];
  const franchisees = franchisee ? [franchisee] : [];
  const partyProfiles = partyProfile ? [partyProfile] : [];
  const callTypes = callType ? [callType] : [];

  const branchSelectOptions = useMemo<RegisterMultiSelectOption[]>(
    () => branchOptions.map((b) => ({ value: b, label: b })),
    [branchOptions]
  );
  const franchiseeSelectOptions = useMemo<RegisterMultiSelectOption[]>(
    () => franchiseeOptions.map((f) => ({ value: f.vendorCode, label: f.label })),
    [franchiseeOptions]
  );
  const partyProfileSelectOptions = useMemo<RegisterMultiSelectOption[]>(
    () => partyProfileOptions.map((p) => ({ value: p, label: p })),
    [partyProfileOptions]
  );
  const callTypeSelectOptions = useMemo<RegisterMultiSelectOption[]>(
    () => callTypeOptions.map((t) => ({ value: t, label: t })),
    [callTypeOptions]
  );

  const resetPage = useCallback(() => setPage(1), []);

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams({ mode: 'options', startDate, endDate });
        const res = await axios.get(`${API}?${params.toString()}`, { withCredentials: true });
        const branches: string[] = res.data.branches ?? [];
        const franchisees: CancelledCallsFranchiseeOption[] = res.data.franchisees ?? [];
        const profiles: string[] = res.data.partyProfiles ?? [];
        const types: string[] = res.data.callTypes ?? [];
        setBranchOptions(branches);
        setFranchiseeOptions(franchisees);
        setPartyProfileOptions(profiles);
        setCallTypeOptions(types);
        setBranch((prev) => (prev && branches.includes(prev) ? prev : ''));
        setFranchisee((prev) =>
          prev && franchisees.some((f) => f.vendorCode === prev) ? prev : ''
        );
        setPartyProfile((prev) => (prev && profiles.includes(prev) ? prev : ''));
        setCallType((prev) => (prev && types.includes(prev) ? prev : ''));
      } catch {
        /* options are best-effort */
      }
    })();
  }, [startDate, endDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = { startDate, endDate, branches, franchisees, partyProfiles, callTypes };
      const [summaryRes, rowsRes] = await Promise.all([
        axios.get<CancelledCallsSummary>(
          `${API}?mode=summary&${buildParams(base).toString()}`,
          { withCredentials: true }
        ),
        axios.get<CancelledCallsRowsResponse>(
          `${API}?${buildParams({ ...base, page, pageSize }).toString()}`,
          { withCredentials: true }
        ),
      ]);
      setSummary(summaryRes.data);
      setRowsData(rowsRes.data);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load cancelled calls';
      feedback.actionFailed(message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, branch, franchisee, partyProfile, callType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const params = buildParams({ startDate, endDate, branches, franchisees, partyProfiles, callTypes });
      params.set('format', 'csv');
      const res = await axios.get(`${API}?${params.toString()}`, {
        withCredentials: true,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancelled-calls-${endDate}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      feedback.actionSuccess('CSV downloaded');
    } catch {
      feedback.actionFailed('CSV export failed');
    } finally {
      setExporting(false);
    }
  }

  const rows: CancelledCallRow[] = rowsData?.rows ?? [];
  const total = rowsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const health = summary?.health;

  return (
    <PageShell
      title="Cancelled Calls"
      subtitle={
        health
          ? `Register rows ${health.totalRows.toLocaleString()} · CRM sync ${
              health.registerLastSyncedAt
                ? formatUiDateTime(health.registerLastSyncedAt)
                : '—'
            }${
              health.registerLagMinutes != null ? ` (${health.registerLagMinutes}m lag)` : ''
            } · max cancelled ${
              health.maxCancelledAt ? formatUiDateTime(health.maxCancelledAt) : '—'
            }`
          : 'Cancelled call register from Postgres (calls_crm_mirror / hot)'
      }
      icon={<Ban className="h-4 w-4" />}
      actions={
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-3 w-3" />
          {exporting ? 'Exporting…' : 'Download CSV'}
        </button>
      }
      toolbar={
        <div className="register-filter-bar border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
          <div className="report-toolbar-filters-row items-end">
            <div className="report-toolbar-filters-date shrink-0">
              <DateRangeSelector
                value={dateRange.label}
                startDate={dateRange.start}
                endDate={dateRange.end}
                onChange={(range) => {
                  resetPage();
                  setDateRange(range);
                }}
              />
            </div>
            <RegisterMultiSelect
              label="Branch"
              emptyLabel="All Branches"
              options={branchSelectOptions}
              selected={branches}
              onChange={(values) => {
                resetPage();
                setBranch(pickSingleFilterValue(values));
              }}
              searchable
              searchPlaceholder="Search branch…"
              panelClassName="w-72"
              layout="inline"
            />
            <RegisterMultiSelect
              label="Franchisee"
              emptyLabel="All Franchisees"
              options={franchiseeSelectOptions}
              selected={franchisees}
              onChange={(values) => {
                resetPage();
                setFranchisee(pickSingleFilterValue(values));
              }}
              searchable
              searchPlaceholder="Search vendor or name…"
              panelClassName="w-80"
              layout="inline"
            />
            <RegisterMultiSelect
              label="Party Profile"
              emptyLabel="All Party Profiles"
              options={partyProfileSelectOptions}
              selected={partyProfiles}
              onChange={(values) => {
                resetPage();
                setPartyProfile(pickSingleFilterValue(values));
              }}
              searchable
              searchPlaceholder="Search party profile…"
              panelClassName="w-64"
              layout="inline"
            />
            <RegisterMultiSelect
              label="Call Type"
              emptyLabel="All Call Types"
              options={callTypeSelectOptions}
              selected={callTypes}
              onChange={(values) => {
                resetPage();
                setCallType(pickSingleFilterValue(values));
              }}
              searchable
              searchPlaceholder="Search call type…"
              panelClassName="w-64"
              layout="inline"
            />
            <span className="ml-auto shrink-0 self-end pb-1 text-[12px] text-slate-500">
              {loading ? 'Loading…' : `${(summary?.total ?? total).toLocaleString()} in range`}
            </span>
          </div>
        </div>
      }
    >
      <PageScrollRegion>
        <div className="p-3">
          <AdminTableCard
            isEmpty={!loading && rows.length === 0}
            empty={
              <p className="p-6 text-sm text-slate-500">
                No cancelled calls in this date range.
              </p>
            }
          >
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>TRN</AdminTh>
                  <AdminTh>Call Date</AdminTh>
                  <AdminTh>Cancelled At</AdminTh>
                  <AdminTh>Branch</AdminTh>
                  <AdminTh>Franchisee</AdminTh>
                  <AdminTh>Party</AdminTh>
                  <AdminTh>Party Profile</AdminTh>
                  <AdminTh>Call Type</AdminTh>
                  <AdminTh>Item Code</AdminTh>
                  <AdminTh>Serial</AdminTh>
                  <AdminTh>Cancel Reason</AdminTh>
                  <AdminTh>Complaint</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {loading ? (
                  <AdminTr>
                    <td className="px-4 py-3 text-[12px] text-slate-500" colSpan={12}>
                      Loading…
                    </td>
                  </AdminTr>
                ) : (
                  rows.map((r) => (
                    <AdminTr key={r.vtrnno}>
                      <AdminTd className="font-mono text-[11px]">{r.vtrnno}</AdminTd>
                      <AdminTd>{formatUiDate(r.loggedAt)}</AdminTd>
                      <AdminTd>{formatUiDateTime(r.cancelledAt)}</AdminTd>
                      <AdminTd>{r.branchName ?? '—'}</AdminTd>
                      <AdminTd>
                        {formatCancelledCallFranchisee(r.franchiseeVendorCode, r.franchiseeName)}
                      </AdminTd>
                      <AdminTd>{r.partyName ?? '—'}</AdminTd>
                      <AdminTd>{r.partyProfile ?? '—'}</AdminTd>
                      <AdminTd>{r.callType ?? '—'}</AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.itemCode ?? '—'}</AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.serial ?? '—'}</AdminTd>
                      <AdminTd>{r.cancelReason || '—'}</AdminTd>
                      <AdminTd className="max-w-[220px] truncate">
                        <span title={r.complaint ?? ''}>{r.complaint ?? '—'}</span>
                      </AdminTd>
                    </AdminTr>
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
