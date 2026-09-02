'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Download,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { PageShell, PageLoadingState } from '@/components/layout/PageShell';
import {
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
  SettingsField,
  settingsInputClass,
} from '@/components/admin/AdminUi';
import type { AttendanceSettings } from '@/modules/attendance/services/org-settings-defaults';
import { ATTENDANCE_ORG_SETTINGS_FALLBACKS } from '@/modules/attendance/services/org-settings-defaults';
import {
  formatDurationMinutes,
  predictedTravelPlusMinusMinutes,
  type ActivityIndication,
} from '@/sql/attendance/activity-metrics';
import type {
  ActivityReportRow,
  OfficeOption,
  RelatedActivityRow,
  SearchBy,
} from '@/sql/attendance/activity-report';
import { mapsUrlFromLatLong } from '@/sql/attendance/maps-url';
import { triggerBlobDownload } from '@/modules/mis/download';
import { useTableSort } from '@/lib/ui/table-sort';

type ColumnKey =
  | 'office'
  | 'technician'
  | 'call_no'
  | 'call_type'
  | 'serial'
  | 'repair_done'
  | 'latlong'
  | 'distance'
  | 'time1'
  | 'time2'
  | 'time3'
  | 'expense'
  | 'approx'
  | 'indication';

type HeaderFilterField = 'office' | 'technician' | 'call_no' | 'call_type' | 'serial' | 'repair_done';

const HEADER_FILTERABLE_COLUMNS: HeaderFilterField[] = [
  'office',
  'technician',
  'call_no',
  'call_type',
  'serial',
  'repair_done',
];

const ALL_COLUMNS: {
  key: ColumnKey;
  label: string;
  hint: string;
  sortable?: boolean;
  defaultVisible?: boolean;
}[] = [
  { key: 'office', label: 'Office', hint: 'Office', sortable: true },
  { key: 'technician', label: 'Technician', hint: 'Technician', sortable: true },
  { key: 'call_no', label: 'Call No.', hint: 'Call Number', sortable: true },
  { key: 'call_type', label: 'Type', hint: 'Call Type', sortable: true },
  { key: 'serial', label: 'Serial', hint: 'Serial Number', sortable: true, defaultVisible: false },
  { key: 'repair_done', label: 'Repair', hint: 'Repair Done', sortable: true },
  { key: 'latlong', label: 'GPS', hint: 'Latlong', sortable: false, defaultVisible: false },
  { key: 'distance', label: 'Dist km', hint: 'ARCP ndistance for this call (trdcalls10ARCP)', sortable: true },
  { key: 'time1', label: 'T1', hint: 'Time since last activity (full gap)', sortable: true },
  {
    key: 'time2',
    label: 'T2',
    hint: 'Assumed repair = Approx you set for repair type',
    sortable: true,
  },
  {
    key: 'time3',
    label: 'T3',
    hint: 'Assumed travel = gap minus Approx — checked vs distance',
    sortable: true,
  },
  { key: 'expense', label: 'Expense ₹', hint: 'Amount claimed for call (ARCP, by call no)', sortable: true },
  {
    key: 'approx',
    label: 'Approx',
    hint: 'Approx repair time you set (Thresholds)',
    sortable: true,
  },
  { key: 'indication', label: 'Flag', hint: 'Indication', sortable: true },
];

const TABLE_SCROLL = 'max-h-[min(55vh,520px)] overflow-auto custom-scrollbar';
const RELATED_SCROLL = 'max-h-[280px] overflow-auto custom-scrollbar';
const TH_CLASS = 'whitespace-nowrap !px-2 !py-2 text-[11px]';
const TD_CLASS = '!px-2 !py-1.5 text-[11px]';

const DEFAULT_CALL_TYPE = 'BREAKDOWN';

function emptyHeaderFilters(): Record<HeaderFilterField, string[]> {
  return {
    office: [],
    technician: [],
    call_no: [],
    call_type: [DEFAULT_CALL_TYPE],
    serial: [],
    repair_done: [],
  };
}

function joinCsv(values: string[]): string | undefined {
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(',') : undefined;
}

function formatMultiLabel(values: string[]): string {
  if (!values.length) return 'All';
  if (values.length === 1) return values[0]!;
  return `${values.length} selected`;
}

const SEARCH_BY_OPTIONS = [
  { value: 'call', label: 'Call' },
  { value: 'serial', label: 'Serial Number' },
  { value: 'call_number', label: 'Call Number' },
  { value: 'office', label: 'Office' },
  { value: 'technician', label: 'Technician' },
] as const;

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: '50', label: '50' },
] as const;

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

function fmtWhen(value: Date | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function fmtWhenFull(value: Date | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function DurationOurs({
  minutes,
  expectedDrive,
  excess,
}: {
  minutes: number | null | undefined;
  expectedDrive?: number | null;
  excess?: number | null;
}) {
  const band = predictedTravelPlusMinusMinutes(expectedDrive);
  return (
    <span>
      {formatDurationMinutes(minutes)}
      {excess != null && expectedDrive != null && excess > 0 && band != null ? (
        <span
          className="mt-0.5 block text-[9px] font-medium text-amber-800"
          title="Rough predicted drive for this distance (± slack for traffic)"
        >
          Predicted around {formatDurationMinutes(expectedDrive)} (±{' '}
          {formatDurationMinutes(band)})
        </span>
      ) : null}
    </span>
  );
}

function CompareStack({
  ours,
  crm,
  showCrm,
}: {
  ours: React.ReactNode;
  crm: React.ReactNode;
  showCrm: boolean;
}) {
  if (!showCrm) return <>{ours}</>;
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span>
        <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-sky-700">
          Ours
        </span>
        {ours}
      </span>
      <span className="text-slate-500">
        <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          CRM
        </span>
        {crm}
      </span>
    </div>
  );
}


function crmTime2Label(crm: ActivityReportRow['crm'], timeAdjusted: boolean): string {
  const start = fmtWhen(crm.service_meeting_start);
  const end = fmtWhen(crm.service_meeting_end);
  const tot = crm.service_total_time?.trim() || '—';
  if (timeAdjusted) return `day closed in CRM · total ${tot}`;
  if (start === end) return `${start}=${end} · total ${tot}`;
  return `${start}→${end} · total ${tot}`;
}

function crmTime3Label(crm: ActivityReportRow['crm']): string {
  if (crm.travel_start || crm.travel_end || crm.travel_total_time) {
    return `${fmtWhen(crm.travel_start)}→${fmtWhen(crm.travel_end)} · ${crm.travel_total_time || '—'}`;
  }
  return '— (no CRM travel time)';
}

function crmGpsLabel(crm: ActivityReportRow['crm']): string {
  return (
    crm.visit_start_latlong ||
    crm.attend_start_latlong ||
    crm.start_latlong ||
    crm.customer_latlong ||
    '—'
  );
}

function fmtDay(day: string | null | undefined): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  if (!y || !m || !d) return day;
  return `${d}/${m}/${y}`;
}

function LatLink({ value }: { value: string | null | undefined }) {
  if (!value) return <span>N/A</span>;
  const url = mapsUrlFromLatLong(value);
  if (!url) return <span className="max-w-[7rem] truncate" title={value}>{value}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="whitespace-nowrap text-sky-700 underline hover:text-sky-900"
      title={value}
      onClick={(e) => e.stopPropagation()}
    >
      {value}
    </a>
  );
}

function IndicationPill({ indication }: { indication: ActivityIndication }) {
  if (indication.kind === 'distance') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">
        <AlertTriangle className="h-3 w-3" />
        {indication.label}
      </span>
    );
  }
  if (indication.kind === 'time_below') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
        <AlertTriangle className="h-3 w-3" />
        {indication.label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
      <Check className="h-3 w-3" />
      Normal
    </span>
  );
}

export default function AttendancePageClient() {
  const [token, setToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const [searchBy, setSearchBy] = useState<SearchBy | ''>('call_number');
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [appliedSearchBy, setAppliedSearchBy] = useState<SearchBy | ''>('call_number');
  const [officeIds, setOfficeIds] = useState<number[]>([]);
  const [headerFilters, setHeaderFilters] = useState(emptyHeaderFilters);
  const [headerOptions, setHeaderOptions] = useState<Record<HeaderFilterField, string[]>>({
    office: [],
    technician: [],
    call_no: [],
    call_type: [],
    serial: [],
    repair_done: [],
  });
  const [callDateFrom, setCallDateFrom] = useState('');
  const [callDateTo, setCallDateTo] = useState('');
  const [activityDateFrom, setActivityDateFrom] = useState(defaultStartDate);
  const [activityDateTo, setActivityDateTo] = useState(defaultEndDate);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<ActivityReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [offices, setOffices] = useState<OfficeOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedActivityRow[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  const [settings, setSettings] = useState<AttendanceSettings>(ATTENDANCE_ORG_SETTINGS_FALLBACKS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<AttendanceSettings>(ATTENDANCE_ORG_SETTINGS_FALLBACKS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [newRepairLabel, setNewRepairLabel] = useState('');
  const [newRepairMins, setNewRepairMins] = useState('60');

  const [columnsOpen, setColumnsOpen] = useState(false);
  const [showCrmCompare, setShowCrmCompare] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>(() =>
    Object.fromEntries(
      ALL_COLUMNS.map((c) => [c.key, c.defaultVisible !== false])
    ) as Record<ColumnKey, boolean>
  );

  const { sort, onSort, sorted } = useTableSort<ColumnKey>(null);

  function sortValue(row: ActivityReportRow, key: ColumnKey): unknown {
    switch (key) {
      case 'office':
        return row.office_name;
      case 'technician':
        return row.technician;
      case 'call_no':
        return row.call_no;
      case 'call_type':
        return row.call_type;
      case 'serial':
        return row.serial;
      case 'repair_done':
        return row.repair_done;
      case 'latlong':
        return row.latlong;
      case 'distance':
        return row.distance_km;
      case 'time1':
        return row.time1_minutes;
      case 'time2':
        return row.time2_minutes;
      case 'time3':
        return row.time3_minutes;
      case 'expense':
        return row.expense_claimed;
      case 'approx':
        return row.approx_minutes;
      case 'indication':
        return row.indication.label;
      default:
        return null;
    }
  }

  const displayRows = useMemo(() => sorted(rows, sortValue), [rows, sorted]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setToken(data.session?.access_token ?? null);
      setBootstrapping(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  const loadOffices = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get('/api/admin/attendance', {
        headers: authHeaders,
        params: {
          meta: 'offices',
          activityDateFrom,
          activityDateTo,
        },
      });
      setOffices(res.data.offices ?? []);
      if (res.data.settings) {
        setSettings(res.data.settings);
        setSettingsDraft(res.data.settings);
      }
    } catch {
      /* soft — branch list optional */
    }
  }, [token, authHeaders, activityDateFrom, activityDateTo]);

  const headerFilterParams = useMemo(
    () => ({
      callTypes: joinCsv(headerFilters.call_type),
      officeNames: joinCsv(headerFilters.office),
      technicianNames: joinCsv(headerFilters.technician),
      callNos: joinCsv(headerFilters.call_no),
      serialNos: joinCsv(headerFilters.serial),
      repairDones: joinCsv(headerFilters.repair_done),
    }),
    [headerFilters]
  );

  const loadHeaderOptions = useCallback(async (field: HeaderFilterField) => {
    if (!token) return;
    try {
      const res = await axios.get('/api/admin/attendance', {
        headers: authHeaders,
        params: {
          meta: 'headerValues',
          field,
          searchBy: appliedSearchBy || undefined,
          q: appliedQ || undefined,
          officeIds: officeIds.length ? officeIds.join(',') : undefined,
          callTypes: field === 'call_type' ? undefined : headerFilterParams.callTypes,
          officeNames: field === 'office' ? undefined : headerFilterParams.officeNames,
          technicianNames: field === 'technician' ? undefined : headerFilterParams.technicianNames,
          callNos: field === 'call_no' ? undefined : headerFilterParams.callNos,
          serialNos: field === 'serial' ? undefined : headerFilterParams.serialNos,
          repairDones: field === 'repair_done' ? undefined : headerFilterParams.repairDones,
          callDateFrom: callDateFrom || undefined,
          callDateTo: callDateTo || undefined,
          activityDateFrom,
          activityDateTo,
        },
      });
      setHeaderOptions((prev) => ({
        ...prev,
        [field]: Array.isArray(res.data.values)
          ? res.data.values.map((t: unknown) => String(t)).filter(Boolean)
          : [],
      }));
    } catch {
      setHeaderOptions((prev) => ({ ...prev, [field]: [] }));
    }
  }, [
    token,
    authHeaders,
    appliedSearchBy,
    appliedQ,
    officeIds,
    headerFilterParams,
    callDateFrom,
    callDateTo,
    activityDateFrom,
    activityDateTo,
  ]);

  const primeHeaderOptions = useCallback(
    (field: HeaderFilterField) => {
      if ((headerOptions[field] ?? []).length === 0) {
        void loadHeaderOptions(field);
      }
    },
    [headerOptions, loadHeaderOptions]
  );

  const loadReport = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/admin/attendance', {
        headers: authHeaders,
        params: {
          searchBy: appliedSearchBy || undefined,
          q: appliedQ || undefined,
          officeIds: officeIds.length ? officeIds.join(',') : undefined,
          ...headerFilterParams,
          callDateFrom: callDateFrom || undefined,
          callDateTo: callDateTo || undefined,
          activityDateFrom,
          activityDateTo,
          page,
          pageSize,
        },
      });
      setRows(res.data.rows ?? []);
      setTotal(Number(res.data.total) || 0);
      if (res.data.settings) {
        setSettings(res.data.settings);
        setSettingsDraft(res.data.settings);
      }
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load activity report';
      setError(msg);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [
    token,
    authHeaders,
    appliedSearchBy,
    appliedQ,
    officeIds,
    headerFilterParams,
    callDateFrom,
    callDateTo,
    activityDateFrom,
    activityDateTo,
    page,
    pageSize,
  ]);

  useEffect(() => {
    void loadOffices();
  }, [loadOffices]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (!token || !selectedKey) {
      setRelated([]);
      return;
    }
    const row = rows.find((r) => r.row_key === selectedKey);
    if (!row?.user_id || !row.activity_day) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setRelatedLoading(true);
      try {
      const res = await axios.get('/api/admin/attendance', {
          headers: authHeaders,
        params: {
            relatedUserId: row.user_id,
            relatedDay: row.activity_day,
            relatedAttdUser: row.technician || undefined,
          },
        });
        if (!cancelled) setRelated(res.data.related ?? []);
        } catch {
        if (!cancelled) setRelated([]);
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authHeaders, selectedKey, rows]);

  function runSearch() {
    setAppliedQ(q.trim());
    setAppliedSearchBy(searchBy);
    setPage(1);
    setSelectedKey(null);
  }

  function clearSearch() {
    setQ('');
    setAppliedQ('');
    setSearchBy('call_number');
    setAppliedSearchBy('call_number');
    setOfficeIds([]);
    setHeaderFilters(emptyHeaderFilters());
    setCallDateFrom('');
    setCallDateTo('');
    setActivityDateFrom(defaultStartDate());
    setActivityDateTo(defaultEndDate());
    setPage(1);
    setSelectedKey(null);
  }

  async function exportCsv() {
    if (!token) return;
    const res = await axios.get('/api/admin/attendance', {
      headers: authHeaders,
      params: {
        export: 'csv',
        searchBy: appliedSearchBy || undefined,
        q: appliedQ || undefined,
        officeIds: officeIds.length ? officeIds.join(',') : undefined,
        ...headerFilterParams,
        callDateFrom: callDateFrom || undefined,
        callDateTo: callDateTo || undefined,
        activityDateFrom,
        activityDateTo,
      },
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    triggerBlobDownload(
      blob,
      `service_call_activity_${activityDateFrom}_${activityDateTo}.csv`
    );
  }

  const selectedOfficeName =
    officeIds.length === 0
      ? 'All Branches'
      : offices.find((o) => o.office_id === officeIds[0])?.office_name || String(officeIds[0]);

  const activeFilterItems = useMemo(
    () => [
      { name: 'Search by', value: SEARCH_BY_OPTIONS.find((o) => o.value === appliedSearchBy)?.label || 'Any' },
      { name: 'Value', value: appliedQ.trim() || 'All' },
      { name: 'Branch', value: selectedOfficeName },
      { name: 'Status', value: 'Tech Solved, Solved' },
      { name: 'Office', value: formatMultiLabel(headerFilters.office) },
      { name: 'Technician', value: formatMultiLabel(headerFilters.technician) },
      { name: 'Call No.', value: formatMultiLabel(headerFilters.call_no) },
      { name: 'Type', value: formatMultiLabel(headerFilters.call_type) },
      { name: 'Serial', value: formatMultiLabel(headerFilters.serial) },
      { name: 'Repair', value: formatMultiLabel(headerFilters.repair_done) },
      { name: 'Call Date from', value: callDateFrom || '—' },
      { name: 'Call Date to', value: callDateTo || '—' },
      { name: 'Activity Date from', value: activityDateFrom || '—' },
      { name: 'Activity Date to', value: activityDateTo || '—' },
    ],
    [
      appliedSearchBy,
      appliedQ,
      selectedOfficeName,
      headerFilters,
      callDateFrom,
      callDateTo,
      activityDateFrom,
      activityDateTo,
    ]
  );

  async function saveSettings() {
    setSettingsSaving(true);
    try {
      const res = await axios.put(
        '/api/admin/attendance-settings',
        { settings: settingsDraft },
        { headers: authHeaders }
      );
      const next = res.data.settings as AttendanceSettings;
      setSettings(next);
      setSettingsDraft(next);
      setSettingsOpen(false);
      void loadReport();
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
        : 'Failed to save thresholds';
      setError(msg);
    } finally {
      setSettingsSaving(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const fromIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toIdx = Math.min(page * pageSize, total);
  const visibleColumnDefs = ALL_COLUMNS.filter((c) => visibleCols[c.key]);
  const selectedHeaderValue = (field: HeaderFilterField): string[] => headerFilters[field];

  const selectedRow = useMemo(
    () => displayRows.find((r) => r.row_key === selectedKey) ?? rows.find((r) => r.row_key === selectedKey) ?? null,
    [displayRows, rows, selectedKey]
  );

  if (bootstrapping) {
    return <PageLoadingState label="Loading attendance…" />;
  }

  if (!token) {
    return (
      <PageShell title="Service Call Activity Report">
        <p className="text-sm text-slate-600">Sign in required.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Service Call Activity Report"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setSettingsDraft(settings);
              setSettingsOpen((v) => !v);
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Thresholds
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto bg-slate-50 p-3">
        {/* Search / filters */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[140px] flex-col gap-1 text-xs text-slate-600">
              Search by
              <FilterSelect
                label="Search by"
                emptyLabel="Search by"
                mode="single"
                options={[...SEARCH_BY_OPTIONS]}
                selected={searchBy ? [searchBy] : []}
                onChange={(values) => setSearchBy((values[0] ?? '') as SearchBy | '')}
                panelClassName="w-56"
              />
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-slate-600">
              Value
              <input
                className={settingsInputClass()}
                value={q}
                placeholder="Enter search value"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
            </label>
          <button
            type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
              onClick={runSearch}
          >
              <Search className="h-3.5 w-3.5" />
              Search
          </button>
          <button
            type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={clearSearch}
          >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
          </button>
        </div>

          {filtersOpen ? (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
              <label className="flex min-w-[180px] flex-col gap-1 text-xs text-slate-600">
                Branch
                <FilterSelect
                  label="Branch"
                  emptyLabel="All Branches"
                  mode="single"
                  options={offices.map((o) => ({
                    value: String(o.office_id),
                    label: o.office_name,
                  }))}
                  selected={officeIds[0] != null ? [String(officeIds[0])] : []}
                  onChange={(values) => {
                    const v = values[0];
                    setOfficeIds(v ? [Number(v)] : []);
                    setPage(1);
                  }}
                  panelClassName="w-64"
                />
              </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
                Call Date from
              <input
                type="date"
                  className={settingsInputClass()}
                  value={callDateFrom}
                onChange={(e) => {
                    setCallDateFrom(e.target.value);
                    setPage(1);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
                Call Date to
              <input
                type="date"
                  className={settingsInputClass()}
                  value={callDateTo}
                onChange={(e) => {
                    setCallDateTo(e.target.value);
                    setPage(1);
                }}
              />
            </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Activity Date from
              <input
                  type="date"
                  className={settingsInputClass()}
                  value={activityDateFrom}
                onChange={(e) => {
                    setActivityDateFrom(e.target.value);
                    setPage(1);
                }}
              />
            </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Activity Date to
                <input
                  type="date"
                  className={settingsInputClass()}
                  value={activityDateTo}
                  onChange={(e) => {
                    setActivityDateTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                onClick={() => setFiltersOpen(false)}
              >
                Hide Filters
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
          </div>
          ) : (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                onClick={() => setFiltersOpen(true)}
              >
                Show Filters
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
          </div>
          )}
        </div>

        {settingsOpen ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Indication thresholds</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs"
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={settingsSaving}
                  className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                  onClick={() => void saveSettings()}
                >
                  {settingsSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            <div className="grid max-w-xl gap-3">
              <SettingsField label="Warn when distance exceeds (km)">
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  className={settingsInputClass()}
                  value={settingsDraft.warnDistanceKm}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      warnDistanceKm: Number(e.target.value) || 50,
                    }))
                  }
                />
              </SettingsField>
              <div>
              <p className="mb-2 text-xs font-medium text-slate-600">
                  Typical minutes by repair done type
              </p>
              <div className="space-y-2">
                  {Object.entries(settingsDraft.repairDoneTypicalMinutes).map(([label, mins]) => (
                    <div key={label} className="flex flex-wrap items-center gap-2">
                    <input
                      className={`${settingsInputClass()} max-w-[280px]`}
                        value={label}
                        onChange={(e) => {
                          const nextLabel = e.target.value;
                          setSettingsDraft((s) => {
                            const map = { ...s.repairDoneTypicalMinutes };
                            delete map[label];
                            map[nextLabel] = mins;
                            return { ...s, repairDoneTypicalMinutes: map };
                          });
                        }}
                    />
                    <input
                      type="number"
                        min={1}
                      className={`${settingsInputClass()} w-24`}
                        value={mins}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                          setSettingsDraft((s) => ({
                          ...s,
                            repairDoneTypicalMinutes: {
                              ...s.repairDoneTypicalMinutes,
                              [label]: Number.isFinite(n) && n > 0 ? n : mins,
                          },
                        }));
                      }}
                    />
                    <button
                      type="button"
                        className="text-xs text-rose-700 hover:underline"
                      onClick={() =>
                          setSettingsDraft((s) => {
                            const map = { ...s.repairDoneTypicalMinutes };
                            delete map[label];
                            return { ...s, repairDoneTypicalMinutes: map };
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    className={`${settingsInputClass()} max-w-[280px]`}
                      placeholder="New repair type"
                      value={newRepairLabel}
                      onChange={(e) => setNewRepairLabel(e.target.value)}
                  />
                  <input
                    type="number"
                      min={1}
                    className={`${settingsInputClass()} w-24`}
                      value={newRepairMins}
                      onChange={(e) => setNewRepairMins(e.target.value)}
                  />
                  <button
                    type="button"
                      className="text-xs font-medium text-sky-700 hover:underline"
                    onClick={() => {
                        const label = newRepairLabel.trim();
                        const mins = Number(newRepairMins);
                        if (!label || !Number.isFinite(mins) || mins <= 0) return;
                        setSettingsDraft((s) => ({
                        ...s,
                          repairDoneTypicalMinutes: {
                            ...s.repairDoneTypicalMinutes,
                            [label]: mins,
                        },
                      }));
                        setNewRepairLabel('');
                        setNewRepairMins('60');
                    }}
                  >
                      Add
                  </button>
                </div>
              </div>
            </div>
            </div>
          </div>
        ) : null}

        {/* Main table — shrink-0 + min-h so related panel can't collapse the body to 0 */}
        <div className="flex min-h-[min(45vh,480px)] min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Service Call Activities</h2>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                Total Records: {total}
              </span>
            </div>
            <div className="relative flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                  showCrmCompare
                    ? 'border-sky-300 bg-sky-50 text-sky-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => setShowCrmCompare((v) => !v)}
                title="Show CRM raw fields next to our derived values"
              >
                CRM vs Ours
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setColumnsOpen((v) => !v)}
              >
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </button>
              {columnsOpen ? (
                <div className="absolute right-0 top-9 z-20 max-h-72 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                  {ALL_COLUMNS.map((c) => (
                    <label
                      key={c.key}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={visibleCols[c.key]}
                        onChange={() =>
                          setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }))
                        }
                      />
                      {c.hint}
                    </label>
                  ))}
          </div>
        ) : null}
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => void exportCsv()}
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => void loadReport()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
            {activeFilterItems.map((f) => (
              <span
                key={f.name}
                className="inline-flex max-w-full items-center gap-1 text-[11px] text-slate-600"
                title={`${f.name}: ${f.value}`}
              >
                <span className="font-medium text-slate-500">{f.name}:</span>
                <span className="truncate font-semibold text-slate-800">{f.value}</span>
              </span>
            ))}
          </div>

          {error ? (
            <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-800">
              {error}
            </div>
          ) : null}

          <AdminTableCard
            isEmpty={!loading && rows.length === 0}
            empty={
              <>
                <p className="text-sm font-medium text-slate-600">No records found</p>
                <p className="ui-micro">Try adjusting search or filters.</p>
              </>
            }
            scrollClassName={TABLE_SCROLL}
          >
            <AdminTable className="w-max min-w-full border-collapse text-left">
              <AdminThead>
                <tr>
                  {visibleColumnDefs.map((c) => {
                    if (HEADER_FILTERABLE_COLUMNS.includes(c.key as HeaderFilterField)) {
                      const field = c.key as HeaderFilterField;
                      const selected = selectedHeaderValue(field);
                      return (
                        <AdminTh
                          key={c.key}
                          className={TH_CLASS}
                          title={c.hint}
                          sortable
                          sortKey={c.key}
                          sort={sort}
                          onSort={(key) => onSort(key as ColumnKey)}
                        >
                          <div
                            className="inline-flex min-w-0 flex-col gap-1"
                            onMouseEnter={() => primeHeaderOptions(field)}
                          >
                            <span>{c.label}</span>
                            <FilterSelect
                              label={c.label}
                              emptyLabel="All"
                              options={(headerOptions[field] ?? []).map((value) => ({
                                value,
                                label: value,
                              }))}
                              selected={selected}
                              onChange={(values) => {
                                setHeaderFilters((prev) => ({ ...prev, [field]: values }));
                                setPage(1);
                                setSelectedKey(null);
                              }}
                              layout="inline"
                              panelClassName="w-64"
                            />
                          </div>
                        </AdminTh>
                      );
                    }
                    return (
                      <AdminTh
                        key={c.key}
                        className={TH_CLASS}
                        title={c.hint}
                        sortable={c.sortable !== false}
                        sortKey={c.key}
                        sort={sort}
                        onSort={(key) => onSort(key as ColumnKey)}
                      >
                        {c.label}
                      </AdminTh>
                    );
                  })}
                </tr>
                    </AdminThead>
                    <tbody>
                {loading && rows.length === 0
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <AdminTr key={`sk-${i}`}>
                        {visibleColumnDefs.map((c) => (
                          <AdminTd key={c.key} className={TD_CLASS}>
                            <div className="h-3 w-12 animate-pulse rounded bg-slate-100" />
                          </AdminTd>
                        ))}
                      </AdminTr>
                    ))
                  : displayRows.map((row) => (
                          <AdminTr
                            key={row.row_key}
                        className={`cursor-pointer ${
                          selectedKey === row.row_key ? 'bg-sky-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => setSelectedKey(row.row_key)}
                      >
                        {visibleColumnDefs.map((c) => {
                          switch (c.key) {
                            case 'office':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} max-w-[9rem] truncate`}>
                                  {row.office_name || '—'}
                            </AdminTd>
                              );
                            case 'technician':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} max-w-[9rem] truncate`}>
                                  {row.technician || '—'}
                            </AdminTd>
                              );
                            case 'call_no':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} whitespace-nowrap font-medium`}>
                                  {row.call_no || '—'}
                                </AdminTd>
                              );
                            case 'call_type':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} whitespace-nowrap`}>
                                  {row.call_type || '—'}
                                </AdminTd>
                              );
                            case 'serial':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} max-w-[7rem] truncate`}>
                                  {row.serial || '—'}
                                </AdminTd>
                              );
                            case 'repair_done':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} max-w-[8rem] truncate`}>
                                  {row.repair_done || '—'}
                                </AdminTd>
                              );
                            case 'latlong':
                              return (
                                <AdminTd key={c.key} className={TD_CLASS}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={<LatLink value={row.latlong} />}
                                    crm={
                                      <span className="break-all" title={crmGpsLabel(row.crm)}>
                                        {row.crm ? crmGpsLabel(row.crm) : '—'}
                                      </span>
                                    }
                                  />
                                </AdminTd>
                              );
                            case 'distance':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} text-right tabular-nums`}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={
                                      <span className="whitespace-nowrap">
                                        {row.distance_km == null
                                          ? 'N/A'
                                          : row.distance_km.toFixed(2)}
                                      </span>
                                    }
                                    crm={
                                      <span className="text-left">
                                        — (from last location)
                                        {row.crm?.prev_latlong ? (
                                          <span
                                            className="mt-0.5 block max-w-[9rem] truncate text-[10px]"
                                            title={row.crm.prev_latlong}
                                          >
                                            prev {row.crm.prev_latlong}
                                </span>
                              ) : null}
                                      </span>
                                    }
                                  />
                            </AdminTd>
                              );
                            case 'time1':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} whitespace-nowrap`}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={<DurationOurs minutes={row.time1_minutes} />}
                                    crm={
                                      row.crm
                                        ? `${fmtWhen(row.crm.prev_act_start)}→${fmtWhen(row.crm.act_start)}`
                                        : '—'
                                    }
                                  />
                            </AdminTd>
                              );
                            case 'time2':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} whitespace-nowrap`}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={
                                      <span title="Assumed repair from Approx (Thresholds)">
                                        {formatDurationMinutes(row.time2_minutes)}
                                </span>
                                    }
                                    crm={
                                      row.crm
                                        ? crmTime2Label(row.crm, row.time_adjusted === true)
                                        : '—'
                                    }
                                  />
                            </AdminTd>
                              );
                            case 'time3':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} whitespace-nowrap`}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={
                                      <DurationOurs
                                        minutes={row.time3_minutes}
                                        expectedDrive={row.expected_travel_minutes}
                                        excess={row.excess_gap_minutes}
                                      />
                                    }
                                    crm={row.crm ? crmTime3Label(row.crm) : '—'}
                              />
                            </AdminTd>
                              );
                            case 'expense':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} text-right tabular-nums whitespace-nowrap`}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={
                                      row.expense_claimed == null
                                        ? '—'
                                        : row.expense_claimed.toLocaleString('en-IN')
                                    }
                                    crm={
                                      row.crm?.expense_amt == null
                                        ? '— (row)'
                                        : `${row.crm.expense_amt}${row.crm.expense_type ? ` · ${row.crm.expense_type}` : ''}`
                                    }
                                  />
                                </AdminTd>
                              );
                            case 'approx':
                              return (
                                <AdminTd key={c.key} className={`${TD_CLASS} whitespace-nowrap`}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={formatDurationMinutes(row.approx_minutes)}
                                    crm="— (our settings)"
                                  />
                                </AdminTd>
                              );
                            case 'indication':
                              return (
                                <AdminTd key={c.key} className={TD_CLASS}>
                                  <CompareStack
                                    showCrm={showCrmCompare}
                                    ours={<IndicationPill indication={row.indication} />}
                                    crm="— (our check)"
                                  />
                                </AdminTd>
                              );
                            default:
                              return null;
                          }
                        })}
                      </AdminTr>
                    ))}
                    </tbody>
                  </AdminTable>
                </AdminTableCard>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
            <span>
              Showing {fromIdx} to {toIdx} of {total} records
            </span>
            <div className="flex items-center gap-1">
                  <button
                    type="button"
                disabled={page <= 1}
                className="rounded border border-slate-200 p-1 disabled:opacity-40"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
              <span className="px-2 tabular-nums">
                {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                className="rounded border border-slate-200 p-1 disabled:opacity-40"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <label className="flex items-center gap-2">
              Rows per page:
              <FilterSelect
                label="Rows per page"
                emptyLabel="Rows per page"
                mode="single"
                options={[...PAGE_SIZE_OPTIONS]}
                selected={[String(pageSize)]}
                onChange={(values) => {
                  setPageSize(Number(values[0] ?? pageSize));
                  setPage(1);
                }}
                layout="inline"
                panelClassName="w-44"
              />
            </label>
          </div>
              </div>

        {/* Related activities */}
        {selectedRow ? (
          <div className="min-w-0 shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">
                Related Activities (Same Date){' '}
                <span className="font-medium text-sky-700">
                  {selectedRow.technician || 'Technician'} · {fmtDay(selectedRow.activity_day)}
                </span>
              </h2>
              {showCrmCompare ? (
                <span className="text-[11px] text-slate-500">
                  Showing our time vs CRM time
                </span>
              ) : null}
            </div>
            <AdminTableCard
              isEmpty={!relatedLoading && related.length === 0}
              empty={<p className="text-sm text-slate-600">No related activities for this day.</p>}
              scrollClassName={RELATED_SCROLL}
            >
              <AdminTable className="w-max min-w-full border-collapse text-left">
                <AdminThead>
                  <tr>
                    <AdminTh className={TH_CLASS}>Date</AdminTh>
                    <AdminTh className={TH_CLASS}>Time</AdminTh>
                    <AdminTh className={TH_CLASS}>Activity</AdminTh>
                    <AdminTh className={TH_CLASS}>Call No.</AdminTh>
                    <AdminTh className={TH_CLASS}>Type</AdminTh>
                    <AdminTh className={TH_CLASS}>GPS</AdminTh>
                    <AdminTh className={TH_CLASS}>Dist km</AdminTh>
                    <AdminTh className={TH_CLASS}>Since last</AdminTh>
                    <AdminTh className={TH_CLASS}>Remarks</AdminTh>
                  </tr>
                </AdminThead>
                <tbody>
                  {relatedLoading ? (
                    <AdminTr>
                      <AdminTd className={TD_CLASS}>Loading…</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                      <AdminTd className={TD_CLASS}>—</AdminTd>
                    </AdminTr>
                  ) : (
                    related.map((ev, i) => (
                      <AdminTr key={`${ev.activity_type}-${i}`}>
                        <AdminTd className={`${TD_CLASS} whitespace-nowrap`}>
                          {fmtWhenFull(ev.activity_time)}
                        </AdminTd>
                        <AdminTd className={`${TD_CLASS} whitespace-nowrap`}>
                          <CompareStack
                            showCrm={showCrmCompare}
                            ours={
                              <span>
                                {fmtWhen(ev.activity_time)}
                                {ev.time_derived ? (
                                  <span className="ml-1 text-[9px] text-amber-700">adjusted</span>
                                ) : null}
                              </span>
                            }
                            crm={
                              <span title={fmtWhenFull(ev.crm_time)}>
                                {fmtWhen(ev.crm_time)}
                                {ev.crm_service_total_time
                                  ? ` · total ${ev.crm_service_total_time}`
                                  : ''}
                              </span>
                            }
                          />
                        </AdminTd>
                        <AdminTd className={`${TD_CLASS} whitespace-nowrap`}>
                          {ev.activity_type}
                        </AdminTd>
                        <AdminTd className={`${TD_CLASS} whitespace-nowrap`}>
                          {ev.call_no || '—'}
                        </AdminTd>
                        <AdminTd className={`${TD_CLASS} whitespace-nowrap`}>
                          {ev.call_type || '—'}
                        </AdminTd>
                        <AdminTd className={TD_CLASS}>
                          <LatLink value={ev.latlong} />
                        </AdminTd>
                        <AdminTd className={`${TD_CLASS} text-right tabular-nums`}>
                          <CompareStack
                            showCrm={showCrmCompare}
                            ours={
                              ev.distance_from_prev_km == null
                                ? '—'
                                : ev.distance_from_prev_km.toFixed(2)
                            }
                            crm="— (calculated)"
                          />
                        </AdminTd>
                        <AdminTd className={`${TD_CLASS} whitespace-nowrap`}>
                          <CompareStack
                            showCrm={showCrmCompare}
                            ours={
                              <DurationOurs minutes={ev.duration_gap_minutes} />
                            }
                            crm="— (calculated)"
                          />
                        </AdminTd>
                        <AdminTd className={`${TD_CLASS} max-w-[14rem]`}>
                          <span className="block truncate" title={ev.remarks || undefined}>
                            {ev.remarks || '—'}
                            </span>
                          </AdminTd>
                        </AdminTr>
                    ))
                  )}
                    </tbody>
                  </AdminTable>
                </AdminTableCard>
              </div>
        ) : null}
      </div>
    </PageShell>
  );
}
