import type { RegisterTableColumnKey } from '@/lib/register-table-columns';
import {
  REGISTER_TABLE_COLUMN_KEYS,
} from '@/lib/register-table-columns';
import {
  buildReportFilterSnapshot,
  defaultDateRange,
  findBreakdownCallType,
  REGISTER_PORTAL_OPTIONS,
  REGISTER_STATUS_OPTIONS,
  type ReportDateRange,
  type ReportFilterSnapshot,
} from '@/lib/report-filters';
import {
  resolveRegisterDateSqlColumn,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls-query';
import { canAccessPath, defaultReportLandingPath } from '@/lib/auth/page-access';

export const USER_REPORT_PREFS_VERSION = 1 as const;

export type StoredReportDateRange = {
  start: string;
  end: string;
  label: string;
};

export type StoredSharedFilters = {
  dateRange?: StoredReportDateRange;
  dateFilterColumn?: RegisterDateFilterColumn;
  selectedOfficeIds?: string[];
  selectedCallTypes?: string[];
  selectedStatus?: string[];
  priorityFilter?: string[];
  portalFilter?: string[];
  selectedState?: string[];
  selectedCity?: string[];
  selectedBranch?: string[];
  selectedFranchisee?: string[];
  selectedTechnician?: string[];
};

export type SerialAuditPreferences = {
  appliedRepairs?: string[];
  minCount?: number;
  onlyFlagged?: boolean;
  includeCancelled?: boolean;
};

export type RegisterPreferences = {
  visibleColumns?: RegisterTableColumnKey[];
  pageSize?: number;
  activeTab?: 'register' | 'summary' | 'accounts';
};

export type UserReportPreferencesV1 = {
  version: typeof USER_REPORT_PREFS_VERSION;
  lastReportPath?: string;
  shared?: StoredSharedFilters;
  serialAudit?: SerialAuditPreferences;
  register?: RegisterPreferences;
  updatedAt?: string;
};

export type RestoreFilterContext = {
  role: string;
  officeIds: string[];
  callTypes: string[];
  /** Office ncode values the user can access in the UI */
  visibleOfficeIds: string[];
};

const MAX_ARRAY_LEN = 64;
const VALID_PRIORITY = new Set(['major', 'minor']);
const VALID_PORTAL = new Set(REGISTER_PORTAL_OPTIONS.map((o) => o.value));
const VALID_STATUS = new Set(REGISTER_STATUS_OPTIONS.map((o) => o.value));
const VALID_REGISTER_TABS = new Set(['register', 'summary', 'accounts']);
const VALID_PAGE_SIZES = new Set([25, 50, 100, 200]);

type DatePreset = { label: string; getValue: () => ReportDateRange };

const DATE_RANGE_PRESETS: DatePreset[] = [
  {
    label: 'Today',
    getValue: () => {
      const d = new Date();
      return {
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
        end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
        label: 'Today',
      };
    },
  },
  {
    label: 'Yesterday',
    getValue: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return {
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
        end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
        label: 'Yesterday',
      };
    },
  },
  {
    label: 'Last 7 Days',
    getValue: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end, label: 'Last 7 Days' };
    },
  },
  {
    label: 'Last 14 Days',
    getValue: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 14);
      start.setHours(0, 0, 0, 0);
      return { start, end, label: 'Last 14 Days' };
    },
  },
  {
    label: 'Last 30 Days',
    getValue: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { start, end, label: 'Last 30 Days' };
    },
  },
  {
    label: 'This Month',
    getValue: () => {
      const d = new Date();
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      return { start, end: new Date(), label: 'This Month' };
    },
  },
  {
    label: 'Last Month',
    getValue: () => {
      const d = new Date();
      const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const end = new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);
      return { start, end, label: 'Last Month' };
    },
  },
  {
    label: 'All Time',
    getValue: () => {
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 20);
      start.setHours(0, 0, 0, 0);
      return { start, end, label: 'All Time' };
    },
  },
];

function capStrings(values: unknown, max = MAX_ARRAY_LEN): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, max);
}

function intersectStrings(values: string[], allowed: Set<string>): string[] {
  if (allowed.size === 0) return values;
  return values.filter((v) => allowed.has(v));
}

export function resolveRollingDateRange(
  label: string | undefined,
  storedStart?: string,
  storedEnd?: string
): ReportDateRange {
  const preset = DATE_RANGE_PRESETS.find((p) => p.label === label);
  if (preset) return preset.getValue();

  if (storedStart && storedEnd) {
    const start = new Date(storedStart);
    const end = new Date(storedEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return { start, end, label: label || 'Custom Range' };
    }
  }

  return defaultDateRange();
}

export function serializeDateRange(range: ReportDateRange): StoredReportDateRange {
  return {
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    label: range.label,
  };
}

export function serializeSharedFilters(snapshot: ReportFilterSnapshot): StoredSharedFilters {
  return {
    dateRange: serializeDateRange(snapshot.dateRange),
    dateFilterColumn: snapshot.dateFilterColumn,
    selectedOfficeIds: snapshot.selectedOfficeIds,
    selectedCallTypes: snapshot.selectedCallTypes,
    selectedStatus: snapshot.selectedStatus,
    priorityFilter: snapshot.priorityFilter,
    portalFilter: snapshot.portalFilter,
    selectedState: snapshot.selectedState,
    selectedCity: snapshot.selectedCity,
    selectedBranch: snapshot.selectedBranch,
    selectedFranchisee: snapshot.selectedFranchisee,
    selectedTechnician: snapshot.selectedTechnician,
  };
}

function allowedOfficeSet(ctx: RestoreFilterContext): Set<string> {
  const ids = new Set<string>();
  for (const id of ctx.visibleOfficeIds) ids.add(String(id));
  if (ctx.role !== 'hod' && ctx.role !== 'super_admin') {
    for (const id of ctx.officeIds) ids.add(String(id));
  }
  return ids;
}

function filterOfficeScoped(values: string[], ctx: RestoreFilterContext): string[] {
  const allowed = allowedOfficeSet(ctx);
  if (ctx.role === 'hod' || ctx.role === 'super_admin') return capStrings(values);
  if (allowed.size === 0) return [];
  return capStrings(values).filter((v) => allowed.has(v));
}

export function buildRoleDefaultShared(ctx: RestoreFilterContext): StoredSharedFilters {
  const dateRange = serializeDateRange(defaultDateRange());
  const breakdown = findBreakdownCallType(ctx.callTypes);
  const shared: StoredSharedFilters = {
    dateRange,
    dateFilterColumn: 'dtrndate',
    selectedOfficeIds: [],
    selectedCallTypes: breakdown ? [breakdown] : [],
    selectedStatus: [],
    priorityFilter: [],
    portalFilter: [],
    selectedState: [],
    selectedCity: [],
    selectedBranch: [],
    selectedFranchisee: [],
    selectedTechnician: [],
  };

  if (ctx.role === 'branch_manager' && ctx.officeIds.length > 0) {
    shared.selectedBranch = [...ctx.officeIds.map(String)];
  }

  return shared;
}

export function sanitizeStoredShared(
  raw: StoredSharedFilters | undefined,
  ctx: RestoreFilterContext
): StoredSharedFilters {
  if (!raw || typeof raw !== 'object') return buildRoleDefaultShared(ctx);

  const callTypeSet = new Set(ctx.callTypes);
  const dateRange = resolveRollingDateRange(
    raw.dateRange?.label,
    raw.dateRange?.start,
    raw.dateRange?.end
  );

  return {
    dateRange: serializeDateRange(dateRange),
    dateFilterColumn: resolveRegisterDateSqlColumn(raw.dateFilterColumn),
    selectedOfficeIds: filterOfficeScoped(raw.selectedOfficeIds ?? [], ctx),
    selectedCallTypes: capStrings(raw.selectedCallTypes).filter((t) =>
      callTypeSet.size === 0 ? true : callTypeSet.has(t)
    ),
    selectedStatus: capStrings(raw.selectedStatus).filter((s) => VALID_STATUS.has(s)),
    priorityFilter: capStrings(raw.priorityFilter).filter((p) => VALID_PRIORITY.has(p)),
    portalFilter: capStrings(raw.portalFilter).filter((p) => VALID_PORTAL.has(p)),
    selectedState: capStrings(raw.selectedState),
    selectedCity: capStrings(raw.selectedCity),
    selectedBranch: filterOfficeScoped(raw.selectedBranch ?? [], ctx),
    selectedFranchisee: filterOfficeScoped(raw.selectedFranchisee ?? [], ctx),
    selectedTechnician: capStrings(raw.selectedTechnician),
  };
}

export function storedSharedToSnapshot(stored: StoredSharedFilters): ReportFilterSnapshot {
  const dateRange = resolveRollingDateRange(
    stored.dateRange?.label,
    stored.dateRange?.start,
    stored.dateRange?.end
  );

  return buildReportFilterSnapshot({
    search: '',
    pincodeSearch: '',
    dateRange,
    dateFilterColumn: resolveRegisterDateSqlColumn(stored.dateFilterColumn),
    selectedOfficeIds: stored.selectedOfficeIds ?? [],
    selectedCallTypes: stored.selectedCallTypes ?? [],
    selectedStatus: stored.selectedStatus ?? [],
    priorityFilter: stored.priorityFilter ?? [],
    portalFilter: stored.portalFilter ?? [],
    selectedState: stored.selectedState ?? [],
    selectedCity: stored.selectedCity ?? [],
    selectedBranch: stored.selectedBranch ?? [],
    selectedFranchisee: stored.selectedFranchisee ?? [],
    selectedTechnician: stored.selectedTechnician ?? [],
  });
}

export function buildRestoredFilterSnapshot(
  prefs: UserReportPreferencesV1 | null | undefined,
  ctx: RestoreFilterContext
): { snapshot: ReportFilterSnapshot; fromSavedPrefs: boolean } {
  const hasSavedShared =
    prefs?.shared &&
    typeof prefs.shared === 'object' &&
    Object.keys(prefs.shared).length > 0;

  const stored = hasSavedShared
    ? sanitizeStoredShared(prefs!.shared, ctx)
    : buildRoleDefaultShared(ctx);

  return {
    snapshot: storedSharedToSnapshot(stored),
    fromSavedPrefs: Boolean(hasSavedShared),
  };
}

export function formatRestoredViewSummary(snapshot: ReportFilterSnapshot): string {
  const parts: string[] = [snapshot.dateRange.label];

  if (snapshot.selectedBranch.length > 0) {
    parts.push(
      snapshot.selectedBranch.length === 1
        ? '1 branch'
        : `${snapshot.selectedBranch.length} branches`
    );
  }

  if (snapshot.selectedStatus.length > 0) {
    parts.push(
      snapshot.selectedStatus.length === 1
        ? '1 status'
        : `${snapshot.selectedStatus.length} statuses`
    );
  }

  if (snapshot.selectedCallTypes.length > 0) {
    parts.push(
      snapshot.selectedCallTypes.length === 1
        ? snapshot.selectedCallTypes[0]
        : `${snapshot.selectedCallTypes.length} call types`
    );
  }

  return parts.join(' · ');
}

export function resolveLandingPath(
  prefs: UserReportPreferencesV1 | null | undefined,
  permissions: string[]
): string {
  const fallback = defaultReportLandingPath(permissions);
  const path = prefs?.lastReportPath;
  if (!path || !path.startsWith('/report')) return fallback;
  if (!canAccessPath(permissions, path)) return fallback;
  return path;
}

export function sanitizeSerialAuditPrefs(
  raw: SerialAuditPreferences | undefined
): SerialAuditPreferences {
  if (!raw || typeof raw !== 'object') return {};
  const minCount =
    typeof raw.minCount === 'number' && raw.minCount >= 1 && raw.minCount <= 99
      ? Math.floor(raw.minCount)
      : undefined;
  return {
    appliedRepairs: capStrings(raw.appliedRepairs, 32),
    minCount,
    onlyFlagged: raw.onlyFlagged === true ? true : undefined,
    includeCancelled: raw.includeCancelled === true ? true : undefined,
  };
}

export function sanitizeRegisterPrefs(raw: RegisterPreferences | undefined): RegisterPreferences {
  if (!raw || typeof raw !== 'object') return {};
  const visibleColumns = capStrings(raw.visibleColumns, REGISTER_TABLE_COLUMN_KEYS.length).filter(
    (k): k is RegisterTableColumnKey =>
      REGISTER_TABLE_COLUMN_KEYS.includes(k as RegisterTableColumnKey)
  );
  const pageSize =
    typeof raw.pageSize === 'number' && VALID_PAGE_SIZES.has(raw.pageSize)
      ? raw.pageSize
      : undefined;
  const activeTab =
    raw.activeTab && VALID_REGISTER_TABS.has(raw.activeTab) ? raw.activeTab : undefined;

  return {
    visibleColumns: visibleColumns.length > 0 ? visibleColumns : undefined,
    pageSize,
    activeTab,
  };
}

export function parseUserReportPreferences(raw: unknown): UserReportPreferencesV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: USER_REPORT_PREFS_VERSION };
  }

  const obj = raw as Record<string, unknown>;
  const lastReportPath =
    typeof obj.lastReportPath === 'string' && obj.lastReportPath.startsWith('/report')
      ? obj.lastReportPath
      : undefined;

  return {
    version: USER_REPORT_PREFS_VERSION,
    lastReportPath,
    shared: obj.shared as StoredSharedFilters | undefined,
    serialAudit: sanitizeSerialAuditPrefs(obj.serialAudit as SerialAuditPreferences | undefined),
    register: sanitizeRegisterPrefs(obj.register as RegisterPreferences | undefined),
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
  };
}

export function mergeUserReportPreferences(
  existing: UserReportPreferencesV1,
  patch: Partial<UserReportPreferencesV1>
): UserReportPreferencesV1 {
  return {
    version: USER_REPORT_PREFS_VERSION,
    lastReportPath: patch.lastReportPath ?? existing.lastReportPath,
    shared:
      patch.shared !== undefined
        ? { ...existing.shared, ...patch.shared }
        : existing.shared,
    serialAudit:
      patch.serialAudit !== undefined
        ? { ...existing.serialAudit, ...patch.serialAudit }
        : existing.serialAudit,
    register:
      patch.register !== undefined
        ? { ...existing.register, ...patch.register }
        : existing.register,
    updatedAt: new Date().toISOString(),
  };
}

export function emptyUserReportPreferences(): UserReportPreferencesV1 {
  return { version: USER_REPORT_PREFS_VERSION, updatedAt: new Date().toISOString() };
}
