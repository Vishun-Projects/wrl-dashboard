'use client';

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Mail, Plus, Trash2, X } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { RegisterMultiSelect, type RegisterMultiSelectOption } from '@/features/register/ui';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { feedback } from '@/lib/ui/feedback';
import {
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminToolbar,
  AdminTr,
  settingsInputClass,
} from '@/components/admin/AdminUi';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

type ClientSourceMode = 'mail' | 'crm';

type RoutingRuleRow = {
  id: string;
  zone: string;
  branch: string;
  client: string;
  clientSourceMode: ClientSourceMode;
  toEmails: string[];
  ccEmails: string[];
  autoSendEnabled: boolean;
  scheduleAnchorTimeIst: string;
  scheduleIntervalMinutes: number;
  scheduleDaysOfWeek: string[];
  scheduleWindowStartIst: string | null;
  scheduleWindowEndIst: string | null;
  createdAt: string;
  updatedAt: string;
};

type EditableRuleRow = {
  id: string;
  zone: string[];
  branch: string[];
  client: string[];
  clientSourceMode: ClientSourceMode;
  toEmailsCsv: string;
  ccEmailsCsv: string;
  autoSendEnabled: boolean;
  scheduleAnchorTimeIst: string;
  scheduleIntervalMinutes: number;
  scheduleDaysOfWeek: string[];
  scheduleWindowStartIst: string;
  scheduleWindowEndIst: string;
};

type RoutingOptionsResponse = {
  zones: string[];
  branches: string[];
  clients: string[];
};

const API_URL = '/api/admin/mis-email-routing';
const OPTIONS_API_URL = '/api/admin/mis-email-routing/options';
const TEMP_ID_PREFIX = 'tmp-';
const ALL_VALUE = 'ALL';
const DAY_OPTIONS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const CLIENT_SOURCE_MODE_OPTIONS: Array<{ value: ClientSourceMode; label: string }> = [
  { value: 'mail', label: 'Mail data' },
  { value: 'crm', label: 'CRM only' },
];
const DAY_LABELS: Record<string, string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
};
const SCHEDULE_INTERVAL_OPTIONS = [
  { value: 15, label: 'Every 15 min' },
  { value: 30, label: 'Every 30 min' },
  { value: 60, label: 'Every 1 hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
];
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RoutingSortKey =
  | 'priority'
  | 'zone'
  | 'branch'
  | 'client'
  | 'clientSourceMode'
  | 'to'
  | 'cc'
  | 'schedule'
  | 'autoSend';

function splitCsvValues(raw: string): string[] {
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function joinCsvValues(values: string[]): string {
  return values.join(', ');
}

function normalizeUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/\s+ZONE$/i, '').toUpperCase();
}

function splitDimensionKeys(value: string): string[] {
  return normalizeUnique(value.split(',').map((token) => normalizeKey(token)));
}

function intervalLabel(minutes: number): string {
  if (minutes >= 1440) return 'Daily';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
  }
  return `Every ${minutes} min`;
}

function scheduleSummary(row: EditableRuleRow): string {
  const repeat = intervalLabel(row.scheduleIntervalMinutes);
  const base = `${repeat} · ${row.scheduleAnchorTimeIst}`;
  if (row.scheduleWindowStartIst && row.scheduleWindowEndIst) {
    return `${base} · ${row.scheduleWindowStartIst}-${row.scheduleWindowEndIst}`;
  }
  return base;
}

function toEditableRow(rule: RoutingRuleRow): EditableRuleRow {
  return {
    id: rule.id,
    zone: splitCsvValues(rule.zone),
    branch: splitCsvValues(rule.branch),
    client: splitCsvValues(rule.client),
    clientSourceMode: rule.clientSourceMode === 'crm' ? 'crm' : 'mail',
    toEmailsCsv: rule.toEmails.join(', '),
    ccEmailsCsv: rule.ccEmails.join(', '),
    autoSendEnabled: rule.autoSendEnabled,
    scheduleAnchorTimeIst: rule.scheduleAnchorTimeIst || '07:00',
    scheduleIntervalMinutes: Number(rule.scheduleIntervalMinutes || 1440),
    scheduleDaysOfWeek:
      Array.isArray(rule.scheduleDaysOfWeek) && rule.scheduleDaysOfWeek.length > 0
        ? rule.scheduleDaysOfWeek
        : [...DAY_OPTIONS],
    scheduleWindowStartIst: rule.scheduleWindowStartIst ?? '',
    scheduleWindowEndIst: rule.scheduleWindowEndIst ?? '',
  };
}

function parseEmailsCsv(csv: string): string[] {
  return normalizeUnique(csv.split(','));
}

function formatScopeCount(values: string[], label: string, totalWhenAll?: number): string {
  if (values.length === 0 && (totalWhenAll ?? 0) > 0) {
    return `${totalWhenAll}/${label}`;
  }
  return `${values.length}/${label}`;
}

function summarizeSelected(values: string[], fallback: string): string {
  if (values.length === 0) return fallback;
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

function serializeRow(row: EditableRuleRow): string {
  return JSON.stringify({
    ...row,
    zone: [...row.zone].sort(),
    branch: [...row.branch].sort(),
    client: [...row.client].sort(),
    scheduleDaysOfWeek: [...row.scheduleDaysOfWeek].sort(),
    toEmailsCsv: row.toEmailsCsv.trim(),
    ccEmailsCsv: row.ccEmailsCsv.trim(),
    scheduleWindowStartIst: row.scheduleWindowStartIst ?? '',
    scheduleWindowEndIst: row.scheduleWindowEndIst ?? '',
  });
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function EmailChipsInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setError(`Invalid email: ${email}`);
      return;
    }
    if (values.includes(email)) {
      setDraft('');
      setError('');
      return;
    }
    onChange([...values, email]);
    setDraft('');
    setError('');
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-slate-500">{label}</label>
      <div className="rounded-md border border-slate-200 bg-bg-canvas p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {values.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-bg-soft px-2 py-0.5 text-[11px] text-slate-700"
            >
              {email}
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== email))}
                className="text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                aria-label={`Remove ${email}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              addEmail(draft);
            }
            if (event.key === 'Backspace' && !draft && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => addEmail(draft)}
          placeholder="Type email and press Enter"
          className="h-8 w-full bg-transparent text-[12px] text-slate-800 outline-none"
        />
      </div>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}

export default function MisEmailRoutingPageClient() {
  const [rows, setRows] = useState<EditableRuleRow[]>([]);
  const [zoneOptions, setZoneOptions] = useState<string[]>([]);
  const [globalBranchOptions, setGlobalBranchOptions] = useState<string[]>([]);
  const [globalClientOptionsByMode, setGlobalClientOptionsByMode] = useState<
    Record<ClientSourceMode, string[]>
  >({
    mail: [],
    crm: [],
  });
  const [branchOptionsByZone, setBranchOptionsByZone] = useState<Record<string, string[]>>({});
  const [clientOptionsByZoneBranch, setClientOptionsByZoneBranch] = useState<Record<string, string[]>>({});
  const [branchToZonesMap, setBranchToZonesMap] = useState<Record<string, string[]>>({});

  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmAutoSend, setConfirmAutoSend] = useState<{ rowId: string; next: boolean } | null>(null);
  const [pendingCloseDirty, setPendingCloseDirty] = useState(false);
  const [drawerBaselineKey, setDrawerBaselineKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<TableSortState<RoutingSortKey> | null>(null);

  useEffect(() => {
    void Promise.all([loadRules(), loadOptions()]);
  }, []);

  useEffect(() => {
    rows.forEach((row) => {
      row.zone.forEach((zone) => void loadBranchOptions(zone));
      const resolvedZones = row.zone.length > 0 ? row.zone : inferZonesForBranches(row.branch);
      resolvedZones.forEach((zone) => {
        row.branch.forEach((branch) => void loadClientOptions(zone, branch, row.clientSourceMode));
      });
    });
  }, [rows]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, sort]);

  async function loadRules() {
    setLoading(true);
    try {
      const res = await axios.get<{ rules: RoutingRuleRow[] }>(API_URL, { withCredentials: true });
      setRows(res.data.rules.map(toEditableRow));
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load routing rules';
      feedback.actionFailed(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadOptions() {
    try {
      const [mailRes, crmRes] = await Promise.all([
        axios.get<RoutingOptionsResponse>(OPTIONS_API_URL, {
          withCredentials: true,
          params: { clientSourceMode: 'mail' },
        }),
        axios.get<RoutingOptionsResponse>(OPTIONS_API_URL, {
          withCredentials: true,
          params: { clientSourceMode: 'crm' },
        }),
      ]);
      setZoneOptions(mailRes.data.zones ?? []);
      setGlobalBranchOptions(mailRes.data.branches ?? []);
      setGlobalClientOptionsByMode({
        mail: mailRes.data.clients ?? [],
        crm: crmRes.data.clients ?? [],
      });
      await Promise.all((mailRes.data.zones ?? []).map(async (zone) => loadBranchOptions(zone)));
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load routing suggestions';
      feedback.actionFailed(message);
    }
  }

  async function loadBranchOptions(zone: string) {
    if (!zone || branchOptionsByZone[zone]) return;
    const res = await axios.get<RoutingOptionsResponse>(OPTIONS_API_URL, {
      withCredentials: true,
      params: { zone },
    });
    const branches = res.data.branches ?? [];
    setBranchOptionsByZone((prev) => ({ ...prev, [zone]: branches }));
    setBranchToZonesMap((prev) => {
      const next = { ...prev };
      branches.forEach((branch) => {
        const existing = new Set(next[branch] ?? []);
        existing.add(zone);
        next[branch] = [...existing];
      });
      return next;
    });
  }

  async function loadClientOptions(zone: string, branch: string, mode: ClientSourceMode) {
    if (!zone || !branch) return;
    const cacheKey = `${mode}::${zone}::${branch}`;
    if (clientOptionsByZoneBranch[cacheKey]) return;
    const res = await axios.get<RoutingOptionsResponse>(OPTIONS_API_URL, {
      withCredentials: true,
      params: { zone, branch, clientSourceMode: mode },
    });
    setClientOptionsByZoneBranch((prev) => ({ ...prev, [cacheKey]: res.data.clients ?? [] }));
  }

  function inferZonesForBranches(branches: string[]): string[] {
    const zones = new Set<string>();
    branches.forEach((branch) => {
      (branchToZonesMap[branch] ?? []).forEach((zone) => zones.add(zone));
    });
    return [...zones];
  }

  function branchOptionsForZones(zones: string[]): string[] {
    if (zones.length === 0) return globalBranchOptions;
    return Array.from(new Set(zones.flatMap((zone) => branchOptionsByZone[zone] ?? []))).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  function clientOptionsFor(zones: string[], branches: string[], mode: ClientSourceMode): string[] {
    if (zones.length === 0 && branches.length === 0) return globalClientOptionsByMode[mode] ?? [];
    const resolvedZones = zones.length > 0 ? zones : inferZonesForBranches(branches);
    const clients = new Set<string>();
    resolvedZones.forEach((zone) => {
      branches.forEach((branch) => {
        (clientOptionsByZoneBranch[`${mode}::${zone}::${branch}`] ?? []).forEach((client) =>
          clients.add(client)
        );
      });
    });
    return clients.size > 0
      ? [...clients].sort((a, b) => a.localeCompare(b))
      : (globalClientOptionsByMode[mode] ?? []);
  }

  function mapToOptions(values: string[]): RegisterMultiSelectOption[] {
    return values.map((value) => ({ value, label: value }));
  }

  function updateRow(id: string, patch: Partial<EditableRuleRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function saveRow(row: EditableRuleRow, closeDrawer = false) {
    setSavingIds((prev) => ({ ...prev, [row.id]: true }));
    try {
      const payload = {
        id: row.id,
        zone: joinCsvValues(row.zone),
        branch: joinCsvValues(row.branch),
        client: joinCsvValues(row.client),
        clientSourceMode: row.clientSourceMode,
        toEmailsCsv: row.toEmailsCsv,
        ccEmailsCsv: row.ccEmailsCsv,
        autoSendEnabled: row.autoSendEnabled,
        scheduleAnchorTimeIst: row.scheduleAnchorTimeIst,
        scheduleIntervalMinutes: row.scheduleIntervalMinutes,
        scheduleDaysOfWeek: row.scheduleDaysOfWeek,
        scheduleWindowStartIst: row.scheduleWindowStartIst || null,
        scheduleWindowEndIst: row.scheduleWindowEndIst || null,
      };
      const res = row.id.startsWith(TEMP_ID_PREFIX)
        ? await axios.post<{ rule: RoutingRuleRow }>(API_URL, payload, { withCredentials: true })
        : await axios.put<{ rule: RoutingRuleRow }>(API_URL, payload, { withCredentials: true });
      const persisted = toEditableRow(res.data.rule);
      setRows((prev) => prev.map((item) => (item.id === row.id ? persisted : item)));
      if (activeRowId === row.id) {
        setDrawerBaselineKey(serializeRow(persisted));
      }
      if (closeDrawer) setActiveRowId(persisted.id);
      feedback.actionSuccess('Routing rule saved');
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to save routing rule';
      feedback.actionFailed(message);
    } finally {
      setSavingIds((prev) => ({ ...prev, [row.id]: false }));
    }
  }

  async function deleteRow(row: EditableRuleRow) {
    if (row.id.startsWith(TEMP_ID_PREFIX)) {
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      if (activeRowId === row.id) setActiveRowId(null);
      return;
    }
    setDeletingIds((prev) => ({ ...prev, [row.id]: true }));
    try {
      await axios.delete(`${API_URL}?id=${encodeURIComponent(row.id)}`, { withCredentials: true });
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      if (activeRowId === row.id) setActiveRowId(null);
      feedback.actionSuccess('Routing rule deleted');
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to delete routing rule';
      feedback.actionFailed(message);
    } finally {
      setDeletingIds((prev) => ({ ...prev, [row.id]: false }));
      setConfirmDeleteId(null);
    }
  }

  function addRuleAndOpenDrawer() {
    const id = `${TEMP_ID_PREFIX}${Date.now()}`;
    const newRow: EditableRuleRow = {
      id,
      zone: [],
      branch: [],
      client: [],
      clientSourceMode: 'mail',
      toEmailsCsv: '',
      ccEmailsCsv: '',
      autoSendEnabled: true,
      scheduleAnchorTimeIst: '07:00',
      scheduleIntervalMinutes: 1440,
      scheduleDaysOfWeek: [...DAY_OPTIONS],
      scheduleWindowStartIst: '',
      scheduleWindowEndIst: '',
    };
    setRows((prev) => [newRow, ...prev]);
    setActiveRowId(id);
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.zone.join(' '),
        row.branch.join(' '),
        row.client.join(' '),
        row.toEmailsCsv,
        row.ccEmailsCsv,
        row.clientSourceMode,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [rows, search]);

  const sortedFilteredRows = useMemo(() => {
    const indexed = filteredRows.map((row, index) => ({ row, index }));
    if (!sort) return indexed;
    return sortRows(indexed, ({ row, index }) => {
      switch (sort.key) {
        case 'priority':
          return index;
        case 'zone':
          return row.zone.join(', ');
        case 'branch':
          return row.branch.join(', ');
        case 'client':
          return row.client.join(', ');
        case 'clientSourceMode':
          return row.clientSourceMode;
        case 'to':
          return parseEmailsCsv(row.toEmailsCsv).length;
        case 'cc':
          return parseEmailsCsv(row.ccEmailsCsv).length;
        case 'schedule':
          return scheduleSummary(row);
        case 'autoSend':
          return row.autoSendEnabled;
        default:
          return '';
      }
    }, sort.dir);
  }, [filteredRows, sort]);

  const handleSort = (key: RoutingSortKey) => {
    setSort((p) =>
      toggleSort(
        p,
        key,
        key === 'zone' || key === 'branch' || key === 'client' || key === 'clientSourceMode' || key === 'schedule'
          ? 'asc'
          : 'desc'
      )
    );
  };

  const totalPages = Math.max(1, Math.ceil(sortedFilteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = sortedFilteredRows
    .slice((safePage - 1) * pageSize, safePage * pageSize)
    .map(({ row }) => row);
  const activeRow = rows.find((row) => row.id === activeRowId) ?? null;
  const deleteTarget = rows.find((row) => row.id === confirmDeleteId) ?? null;
  const activeRowKey = activeRow ? serializeRow(activeRow) : null;
  const drawerDirty = !!(activeRow && drawerBaselineKey && activeRowKey !== drawerBaselineKey);

  useEffect(() => {
    if (!activeRow) {
      setDrawerBaselineKey(null);
      return;
    }
    setDrawerBaselineKey(serializeRow(activeRow));
  }, [activeRowId]);

  function requestCloseDrawer() {
    if (drawerDirty) {
      setPendingCloseDirty(true);
      return;
    }
    setActiveRowId(null);
  }

  return (
    <PageShell
      title="MIS Email Routing"
      subtitle="Scan rules quickly in the table, then edit full details in the side panel."
      icon={<Mail size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      toolbar={
        <AdminToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search zones, branches, clients, or recipients..."
        >
          <button
            type="button"
            onClick={addRuleAndOpenDrawer}
            className="flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <Plus size={14} />
            Add Rule
          </button>
        </AdminToolbar>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <AdminTableCard isEmpty={!loading && filteredRows.length === 0}>
          {loading ? (
            <div className="p-6 text-[12px] text-slate-500">Loading routing rules...</div>
          ) : (
            <>
              <AdminTable className="w-full min-w-[1180px] border-collapse text-left">
                <AdminThead>
                  <tr>
                    <AdminTh
                      className="w-[6%]"
                      sortable
                      sortKey="priority"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      Priority
                    </AdminTh>
                    <AdminTh
                      className="w-[12%]"
                      sortable
                      sortKey="zone"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      Zone
                    </AdminTh>
                    <AdminTh
                      className="w-[12%]"
                      sortable
                      sortKey="branch"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      Branch
                    </AdminTh>
                    <AdminTh
                      className="w-[10%]"
                      sortable
                      sortKey="client"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      Client
                    </AdminTh>
                    <AdminTh
                      className="w-[10%]"
                      sortable
                      sortKey="clientSourceMode"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      Client basis
                    </AdminTh>
                    <AdminTh
                      className="w-[10%]"
                      sortable
                      sortKey="to"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      To
                    </AdminTh>
                    <AdminTh
                      className="w-[10%]"
                      sortable
                      sortKey="cc"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      CC
                    </AdminTh>
                    <AdminTh
                      className="w-[14%]"
                      sortable
                      sortKey="schedule"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      Schedule
                    </AdminTh>
                    <AdminTh
                      className="w-[8%]"
                      align="center"
                      sortable
                      sortKey="autoSend"
                      sort={sort}
                      onSort={(k) => handleSort(k as RoutingSortKey)}
                    >
                      Auto-send
                    </AdminTh>
                    <AdminTh className="w-[8%]" align="right">
                      Actions
                    </AdminTh>
                  </tr>
                </AdminThead>
                <tbody>
                  {pagedRows.map((row) => {
                    const index =
                      sortedFilteredRows.findIndex((candidate) => candidate.row.id === row.id) + 1;
                    const deleting = deletingIds[row.id] === true;
                    const saving = savingIds[row.id] === true;
                    return (
                      <AdminTr
                        key={row.id}
                        className="h-14"
                        onClick={() => setActiveRowId(row.id)}
                      >
                        <AdminTd>
                          <span className="inline-flex rounded-md border border-slate-200 bg-bg-soft px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            #{index}
                          </span>
                        </AdminTd>
                        <AdminTd>
                          <span
                            title={row.zone.join(', ') || 'All zones'}
                            className="inline-flex rounded-full border border-slate-200 bg-bg-soft px-2 py-0.5 text-[10px] font-medium text-slate-700"
                          >
                            {formatScopeCount(row.zone, 'zones', zoneOptions.length)}
                          </span>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {summarizeSelected(row.zone, 'All zones')}
                          </p>
                        </AdminTd>
                        <AdminTd>
                          <span
                            title={row.branch.join(', ') || 'All branches'}
                            className="inline-flex rounded-full border border-slate-200 bg-bg-soft px-2 py-0.5 text-[10px] font-medium text-slate-700"
                          >
                            {formatScopeCount(row.branch, 'branches', globalBranchOptions.length)}
                          </span>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {summarizeSelected(row.branch, 'All branches')}
                          </p>
                        </AdminTd>
                        <AdminTd>
                          <span
                            title={row.client.join(', ') || 'All clients'}
                            className="inline-flex rounded-full border border-slate-200 bg-bg-soft px-2 py-0.5 text-[10px] font-medium text-slate-700"
                          >
                            {formatScopeCount(
                              row.client,
                              'clients',
                              globalClientOptionsByMode[row.clientSourceMode]?.length ?? 0
                            )}
                          </span>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {summarizeSelected(row.client, 'All clients')}
                          </p>
                        </AdminTd>
                        <AdminTd>
                          <span className="text-[11px] font-medium text-slate-700">
                            {row.clientSourceMode === 'crm' ? 'CRM only' : 'Mail data'}
                          </span>
                        </AdminTd>
                        <AdminTd>
                          <span
                            title={parseEmailsCsv(row.toEmailsCsv).join(', ') || 'No recipients'}
                            className="inline-flex rounded-full border border-slate-200 bg-bg-soft px-2 py-0.5 text-[10px] font-medium text-slate-700"
                          >
                            {parseEmailsCsv(row.toEmailsCsv).length} recipients
                          </span>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {summarizeSelected(parseEmailsCsv(row.toEmailsCsv), 'None')}
                          </p>
                        </AdminTd>
                        <AdminTd>
                          <span
                            title={parseEmailsCsv(row.ccEmailsCsv).join(', ') || 'No recipients'}
                            className="inline-flex rounded-full border border-slate-200 bg-bg-soft px-2 py-0.5 text-[10px] font-medium text-slate-700"
                          >
                            {parseEmailsCsv(row.ccEmailsCsv).length} recipients
                          </span>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {summarizeSelected(parseEmailsCsv(row.ccEmailsCsv), 'None')}
                          </p>
                        </AdminTd>
                        <AdminTd>
                          <span className="text-[11px] text-slate-700">{scheduleSummary(row)}</span>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {row.scheduleDaysOfWeek.length === DAY_OPTIONS.length
                              ? 'All days'
                              : summarizeSelected(
                                  row.scheduleDaysOfWeek.map((d) => DAY_LABELS[d] || d),
                                  'All days'
                                )}
                          </p>
                        </AdminTd>
                        <AdminTd align="center">
                          <ToggleSwitch
                            checked={row.autoSendEnabled}
                            disabled={saving || deleting}
                            label={`Toggle auto send for rule ${row.id}`}
                            onChange={(next) => {
                              setConfirmAutoSend({ rowId: row.id, next });
                            }}
                          />
                        </AdminTd>
                        <AdminTd align="right">
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmDeleteId(row.id);
                            }}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-bg-soft disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                        </AdminTd>
                      </AdminTr>
                    );
                  })}
                </tbody>
              </AdminTable>

              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[11px] text-slate-600">
                <div>
                  Showing {sortedFilteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-
                  {Math.min(safePage * pageSize, sortedFilteredRows.length)} of {sortedFilteredRows.length}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={String(pageSize)}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className={`${settingsInputClass()} h-8 w-[88px] px-2 text-[11px]`}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={String(size)}>
                        {size}/page
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="h-8 rounded-md border border-slate-200 px-2 text-[11px] disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <span className="px-1 text-[11px]">
                    {safePage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    className="h-8 rounded-md border border-slate-200 px-2 text-[11px] disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </AdminTableCard>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this rule?"
        description="This can't be undone."
        confirmLabel="Delete rule"
        variant="danger"
        loading={!!(deleteTarget && deletingIds[deleteTarget.id])}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void deleteRow(deleteTarget);
        }}
      />
      <ConfirmDialog
        open={!!confirmAutoSend}
        title={confirmAutoSend?.next ? 'Enable auto-send?' : 'Disable auto-send?'}
        description="This change is saved immediately and affects live routing behavior."
        confirmLabel={confirmAutoSend?.next ? 'Enable' : 'Disable'}
        onCancel={() => setConfirmAutoSend(null)}
        onConfirm={() => {
          if (!confirmAutoSend) return;
          const row = rows.find((item) => item.id === confirmAutoSend.rowId);
          if (!row) return;
          const updated = { ...row, autoSendEnabled: confirmAutoSend.next };
          updateRow(row.id, { autoSendEnabled: confirmAutoSend.next });
          setConfirmAutoSend(null);
          void saveRow(updated);
        }}
      />
      <ConfirmDialog
        open={pendingCloseDirty}
        title="Discard unsaved changes?"
        description="Your unsaved edits in this routing rule will be lost."
        confirmLabel="Discard changes"
        variant="danger"
        onCancel={() => setPendingCloseDirty(false)}
        onConfirm={() => {
          setPendingCloseDirty(false);
          void loadRules();
          setActiveRowId(null);
        }}
      />

      <ModalPortal open={!!activeRow}>
        {activeRow ? (
          <div className="fixed inset-0 z-[190]">
            <ModalBackdrop onClick={requestCloseDrawer} />
            <div className="absolute right-0 top-0 z-[191] flex h-full w-full max-w-[760px] flex-col border-l border-slate-200 bg-bg-canvas shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Edit routing rule</h2>
                  <p className="text-[11px] text-slate-500">
                    Configure scope, recipients, and schedule.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={requestCloseDrawer}
                  className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-bg-soft"
                  aria-label="Close editor"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="rounded-lg border border-slate-200 bg-bg-soft/50 px-3 py-2 text-[11px] text-slate-600">
                  Scope dependencies: selected zones filter branches, and zones + branches filter
                  clients. Existing valid selections are preserved.
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-slate-500">Client basis</label>
                    <select
                      className={settingsInputClass()}
                      value={activeRow.clientSourceMode}
                      onChange={(event) => {
                        const mode: ClientSourceMode = event.target.value === 'crm' ? 'crm' : 'mail';
                        updateRow(activeRow.id, { clientSourceMode: mode, client: [] });
                      }}
                    >
                      {CLIENT_SOURCE_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-slate-500">Zones</label>
                    <RegisterMultiSelect
                      label="Zones"
                      emptyLabel={`All zones (${zoneOptions.length})`}
                      options={mapToOptions(zoneOptions)}
                      selected={activeRow.zone}
                      searchable
                      showSelectAll
                      selectAllLabel="Select all"
                      panelClassName="w-80"
                      onChange={(values) => {
                        const nextZones = normalizeUnique(values);
                        const nextBranchOptions = branchOptionsForZones(nextZones);
                        const preservedBranches =
                          nextZones.length === 0
                            ? activeRow.branch
                            : activeRow.branch.filter((branch) =>
                                nextBranchOptions.includes(branch)
                              );
                        const nextClientOptions = clientOptionsFor(
                          nextZones,
                          preservedBranches,
                          activeRow.clientSourceMode
                        );
                        const preservedClients = activeRow.client.filter((client) =>
                          nextClientOptions.includes(client)
                        );
                        updateRow(activeRow.id, {
                          zone: nextZones,
                          branch: preservedBranches,
                          client: preservedClients,
                        });
                        nextZones.forEach((zone) => void loadBranchOptions(zone));
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-slate-500">Branches</label>
                    <RegisterMultiSelect
                      label="Branches"
                      emptyLabel={`All branches (${globalBranchOptions.length})`}
                      options={mapToOptions(branchOptionsForZones(activeRow.zone))}
                      selected={activeRow.branch}
                      searchable
                      showSelectAll
                      selectAllLabel="Select all"
                      panelClassName="w-80"
                      onChange={(values) => {
                        const branch = normalizeUnique(values);
                        const inferredZones = inferZonesForBranches(branch);
                        const zone = activeRow.zone.length > 0 ? activeRow.zone : inferredZones;
                        const nextClientOptions = clientOptionsFor(
                          normalizeUnique(zone),
                          branch,
                          activeRow.clientSourceMode
                        );
                        const preservedClients = activeRow.client.filter((client) =>
                          nextClientOptions.includes(client)
                        );
                        updateRow(activeRow.id, {
                          zone: normalizeUnique(zone),
                          branch,
                          client: preservedClients,
                        });
                        zone.forEach((zoneName) => {
                          branch.forEach((branchName) => {
                            void loadClientOptions(zoneName, branchName, activeRow.clientSourceMode);
                          });
                        });
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-slate-500">Clients</label>
                    <RegisterMultiSelect
                      label="Clients"
                      emptyLabel={`All clients (${globalClientOptionsByMode[activeRow.clientSourceMode]?.length ?? 0})`}
                      options={mapToOptions(
                        clientOptionsFor(activeRow.zone, activeRow.branch, activeRow.clientSourceMode)
                      )}
                      selected={activeRow.client}
                      searchable
                      showSelectAll
                      selectAllLabel="Select all"
                      panelClassName="w-80"
                      onChange={(values) => updateRow(activeRow.id, { client: normalizeUnique(values) })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <EmailChipsInput
                    label="To recipients"
                    values={parseEmailsCsv(activeRow.toEmailsCsv)}
                    onChange={(next) => updateRow(activeRow.id, { toEmailsCsv: joinCsvValues(next) })}
                  />
                  <EmailChipsInput
                    label="CC recipients"
                    values={parseEmailsCsv(activeRow.ccEmailsCsv)}
                    onChange={(next) => updateRow(activeRow.id, { ccEmailsCsv: joinCsvValues(next) })}
                  />
                </div>

                <div className="rounded-lg border border-slate-200 bg-bg-soft/60 p-4">
                  <p className="mb-3 text-[11px] font-medium text-slate-600">Schedule</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">Start time (IST)</label>
                      <input
                        type="time"
                        className={settingsInputClass()}
                        value={activeRow.scheduleAnchorTimeIst}
                        onChange={(event) =>
                          updateRow(activeRow.id, { scheduleAnchorTimeIst: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">Repeat</label>
                      <select
                        className={settingsInputClass()}
                        value={String(activeRow.scheduleIntervalMinutes)}
                        onChange={(event) =>
                          updateRow(activeRow.id, {
                            scheduleIntervalMinutes: Number(event.target.value || 1440),
                          })
                        }
                      >
                        {SCHEDULE_INTERVAL_OPTIONS.map((opt) => (
                          <option key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">On days</label>
                      <RegisterMultiSelect
                        label="Days"
                        emptyLabel="All days"
                        options={DAY_OPTIONS.map((day) => ({ value: day, label: DAY_LABELS[day] || day }))}
                        selected={activeRow.scheduleDaysOfWeek}
                        panelClassName="w-80"
                        showSelectAll
                        selectAllLabel="Select all"
                        onChange={(values) =>
                          updateRow(activeRow.id, {
                            scheduleDaysOfWeek: values.length > 0 ? normalizeUnique(values) : [...DAY_OPTIONS],
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">
                        Allowed time range (optional)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="time"
                          className={settingsInputClass()}
                          value={activeRow.scheduleWindowStartIst}
                          onChange={(event) =>
                            updateRow(activeRow.id, { scheduleWindowStartIst: event.target.value })
                          }
                        />
                        <input
                          type="time"
                          className={settingsInputClass()}
                          value={activeRow.scheduleWindowEndIst}
                          onChange={(event) =>
                            updateRow(activeRow.id, { scheduleWindowEndIst: event.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-bg-canvas px-5 py-3">
                {drawerDirty ? (
                  <p className="mr-auto text-[11px] text-amber-700">Unsaved changes</p>
                ) : null}
                <button
                  type="button"
                  onClick={requestCloseDrawer}
                  className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-bg-soft"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingIds[activeRow.id] === true}
                  onClick={() => void saveRow(activeRow)}
                  className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingIds[activeRow.id] ? 'Saving...' : 'Save rule'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </ModalPortal>
    </PageShell>
  );
}
