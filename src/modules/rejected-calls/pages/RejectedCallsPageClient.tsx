'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { TrnLink } from '@/components/calls/TrnLink';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { AnimatedMetric } from '@/components/motion';
import { formatUiDate, formatUiDateTime } from '@/lib/dates/ui-date';
import { feedback } from '@/lib/ui/feedback';
import {
  formatReportScopeSubtitle,
  getCallTypeBadgeClass,
  resolveSummaryOfficeIdsParam,
  toDateString,
  type ExtraActiveFilterChip,
} from '@/modules/mis';
import { useReportFilters } from '@/modules/mis/components';
import { RegisterPageFilters } from '@/modules/mis/register/components/RegisterPageFilters';
import type {
  RejectedBySource,
  RejectedCallRow,
  RejectedCallsRowsResponse,
  RejectedCallsSummary,
} from '@/modules/rejected-calls/types';
import { groupReasonBuckets, prettyReasonLabel } from '@/sql/rejected-calls/reason-groups';

const API = '/api/report/rejected-calls';
const PAGE_SIZE = 50;

const SOURCE_OPTIONS: FilterSelectOption[] = [
  { value: 'HO', label: 'HO' },
  { value: 'Branch', label: 'Branch' },
];

function franchiseeLabel(name: string | null): string {
  const t = (name ?? '').trim();
  if (!t || t.toLowerCase() === 'unallocated') return '—';
  return t;
}

export default function RejectedCallsPageClient() {
  const {
    appliedFilters,
    appliedRevision,
    prefsReady,
    resourcesLoaded,
    offices,
    setSelectedCallTypes,
  } = useReportFilters();

  const [source, setSource] = useState<RejectedBySource | ''>('');
  const [reasons, setReasons] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<RejectedCallsSummary | null>(null);
  const [rowsData, setRowsData] = useState<RejectedCallsRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const stripAtRevision = useRef<number | null>(null);

  const ready = Boolean(prefsReady && resourcesLoaded && appliedFilters);

  // Leftover Call Register type (often Breakdown) was masking branch/franchisee.
  useLayoutEffect(() => {
    if (!prefsReady || stripAtRevision.current != null) return;
    stripAtRevision.current = appliedRevision;
    setSelectedCallTypes([]);
  }, [appliedRevision, prefsReady, setSelectedCallTypes]);

  const officeIds = useMemo(() => {
    if (!appliedFilters) return 'All';
    return resolveSummaryOfficeIdsParam(
      offices,
      appliedFilters.selectedBranch,
      appliedFilters.selectedFranchisee
    );
  }, [appliedFilters, offices]);

  const buildParams = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams({
        startDate: appliedFilters ? toDateString(appliedFilters.dateRange.start) : '',
        endDate: appliedFilters ? toDateString(appliedFilters.dateRange.end) : '',
        ...extra,
      });
      if (appliedFilters?.dateFilterColumn) {
        params.set('dateFilterColumn', appliedFilters.dateFilterColumn);
      }
      if (
        appliedFilters?.selectedCallTypes.length &&
        appliedRevision !== stripAtRevision.current
      ) {
        params.set('callType', appliedFilters.selectedCallTypes.join(','));
      }
      if (officeIds !== 'All') params.set('officeId', officeIds);
      if (appliedFilters?.selectedTechnician.length) {
        params.set('technician', appliedFilters.selectedTechnician.join(','));
      }
      if (appliedFilters?.repairFilter.length) {
        params.set('repair', appliedFilters.repairFilter.join(','));
      }
      const search = appliedFilters?.search.trim();
      if (search) params.set('search', search);
      if (source) params.set('source', source);
      if (reasons.length) params.set('reasons', reasons.join(','));
      return params;
    },
    [appliedFilters, appliedRevision, officeIds, reasons, source]
  );

  useEffect(() => {
    setPage(1);
  }, [appliedRevision, officeIds, source, reasons]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    const first = rowsData == null;
    if (first) setLoading(true);
    else setUpdating(true);
    const mode = page === 1 ? 'full' : 'rows';
    void (async () => {
      try {
        const params = buildParams({
          mode,
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });
        const res = await fetch(`${API}?${params}`, { credentials: 'include', signal: ac.signal });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        const data = body as RejectedCallsRowsResponse;
        setRowsData(data);
        if (data.summary) setSummary(data.summary);
      } catch (err) {
        if (ac.signal.aborted) return;
        feedback.actionFailed(err instanceof Error ? err.message : 'Failed to load rejected calls');
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
          setUpdating(false);
        }
      }
    })();
    return () => ac.abort();
  }, [buildParams, page, ready]);

  const rows: RejectedCallRow[] = rowsData?.rows ?? [];
  const total = rowsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedTypes = appliedFilters?.selectedCallTypes ?? [];
  const totalActive = selectedTypes.length === 0;
  const reasonOptions = useMemo<FilterSelectOption[]>(
    () =>
      groupReasonBuckets(summary?.byReason ?? []).map((r) => ({
        value: r.key,
        label: `${r.label} (${r.count})`,
      })),
    [summary]
  );

  const extraActiveChips = useMemo((): ExtraActiveFilterChip[] => {
    const chips: ExtraActiveFilterChip[] = [];
    if (source) {
      chips.push({
        id: 'rejected-source',
        label: `Rejected by: ${source}`,
        onRemove: () => setSource(''),
      });
    }
    for (const reason of reasons) {
      chips.push({
        id: `rejected-reason:${reason}`,
        label: `Reason: ${prettyReasonLabel(reason)}`,
        onRemove: () => setReasons((prev) => prev.filter((r) => r !== reason)),
      });
    }
    return chips;
  }, [reasons, source]);

  const drawerExtra = (
    <div className="flex flex-col gap-3">
      <FilterSelect
        label="Rejected by"
        emptyLabel="HO / Branch"
        options={SOURCE_OPTIONS}
        selected={source ? [source] : []}
        mode="single"
        onChange={(values) => {
          const next = values[values.length - 1];
          setSource(next === 'HO' || next === 'Branch' ? next : '');
        }}
        panelClassName="w-56"
      />
      <FilterSelect
        label="Rejection reason"
        emptyLabel="All reasons"
        options={reasonOptions}
        selected={reasons}
        onChange={setReasons}
        searchPlaceholder="Search reason…"
        panelClassName="w-80"
      />
    </div>
  );

  const subtitle = appliedFilters
    ? formatReportScopeSubtitle(
        appliedFilters.dateRange,
        appliedFilters.selectedBranch.length,
        appliedFilters.selectedFranchisee.length
      )
    : 'Currently rejected by HO or Branch Manager';

  return (
    <PageShell
      title="Rejected Calls"
      subtitle={subtitle}
      icon={<XCircle className="h-4 w-4" />}
      toolbar={
        <RegisterPageFilters
          updating={updating}
          updatingLabel="Updating rejected calls…"
          extraActiveChips={extraActiveChips}
          extraFilterCount={(source ? 1 : 0) + reasons.length}
          drawerExtra={drawerExtra}
        />
      }
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
    >
      <PageScrollRegion className="gap-3 p-4">
        <div className="register-stats-bar">
          <button
            type="button"
            className={`register-stat-item register-stat-item--clickable ${totalActive ? 'register-stat-item--active' : ''}`}
            onClick={() => setSelectedCallTypes([])}
            title="All rejected calls in the current filters"
          >
            <AnimatedMetric
              value={summary?.total ?? 0}
              className="register-stat-value text-slate-900"
            />
            <span className="register-stat-label">All types</span>
          </button>
          {(summary?.byCallType ?? []).map((item) => {
            const active = selectedTypes.length === 1 && selectedTypes[0] === item.label;
            return (
              <button
                key={item.label}
                type="button"
                className={`register-stat-item register-stat-item--clickable ${active ? 'register-stat-item--active' : ''}`}
                onClick={() => setSelectedCallTypes(active ? [] : [item.label])}
                title={`Filter to ${item.label}`}
              >
                <AnimatedMetric value={item.count} className="register-stat-value text-slate-900" />
                <span className="register-stat-label">{item.label}</span>
              </button>
            );
          })}
        </div>

        <AdminTableCard
          isEmpty={!loading && rows.length === 0}
          empty={<p className="p-6 text-sm text-slate-500">No rejected calls in this filter scope.</p>}
        >
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh>Call No</AdminTh>
                <AdminTh>Call Date</AdminTh>
                <AdminTh>Sr No</AdminTh>
                <AdminTh>Call type</AdminTh>
                <AdminTh>Branch</AdminTh>
                <AdminTh>Franchisee</AdminTh>
                <AdminTh>Activity Done / Repair Done</AdminTh>
                <AdminTh>Solve Date</AdminTh>
                <AdminTh>Reject By HO / Branch</AdminTh>
                <AdminTh>Rejection date</AdminTh>
                <AdminTh>Rejection Reason</AdminTh>
                <AdminTh>Rejected By</AdminTh>
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
                  <AdminTr key={`${r.ncode}-${r.nofficeid}`}>
                    <AdminTd className="font-mono text-[11px]">
                      <TrnLink
                        trn={r.callNo}
                        callId={String(r.ncode)}
                        officeId={String(r.nofficeid)}
                        className="text-left font-mono text-[11px] text-slate-800 hover:underline"
                      />
                    </AdminTd>
                    <AdminTd>{formatUiDate(r.callDate)}</AdminTd>
                    <AdminTd className="font-mono text-[11px]">{r.serialNo ?? '—'}</AdminTd>
                    <AdminTd>
                      {r.callType ? (
                        <span className={getCallTypeBadgeClass(r.callType)}>{r.callType}</span>
                      ) : (
                        '—'
                      )}
                    </AdminTd>
                    <AdminTd>{r.branchName ?? '—'}</AdminTd>
                    <AdminTd>{franchiseeLabel(r.franchiseeName)}</AdminTd>
                    <AdminTd className="max-w-[220px] truncate">
                      <span title={r.activityDone ?? ''}>{r.activityDone ?? '—'}</span>
                    </AdminTd>
                    <AdminTd>{formatUiDate(r.solveDate)}</AdminTd>
                    <AdminTd>{r.rejectedBySource}</AdminTd>
                    <AdminTd>{formatUiDateTime(r.rejectionAt)}</AdminTd>
                    <AdminTd className="max-w-[280px] truncate">
                      <span title={r.rejectionReason ?? ''}>{r.rejectionReason ?? '—'}</span>
                    </AdminTd>
                    <AdminTd>{r.rejectedByName ?? '—'}</AdminTd>
                  </AdminTr>
                ))
              )}
            </tbody>
          </AdminTable>
        </AdminTableCard>

        <div className="flex items-center justify-between text-[12px] text-slate-600">
          <span>
            {loading ? 'Loading…' : `${total.toLocaleString()} in scope`} · Page {page} of {totalPages}
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
      </PageScrollRegion>
    </PageShell>
  );
}
