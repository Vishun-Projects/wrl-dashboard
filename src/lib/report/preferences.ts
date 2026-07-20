import {
  buildReportFilterSnapshot,
  defaultAgingAsOfForRange,
  defaultDateRange,
  findBreakdownCallType,
  normalizeAgingAsOfDate,
  REGISTER_PORTAL_OPTIONS,
  REGISTER_STATUS_OPTIONS,
  type ReportDateRange,
  type ReportFilterSnapshot,
} from '@/lib/report/filters';
import { isRepairNcodeValue } from '@/lib/serial-audit/repair-options';
import {
  resolveRegisterDateSqlColumn,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls/query';

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
  repairFilter?: string[];
  selectedState?: string[];
  selectedCity?: string[];
  selectedRegion?: string[];
  selectedAccount?: string[];
  selectedBranch?: string[];
  selectedFranchisee?: string[];
  selectedTechnician?: string[];
  agingAsOf?: string;
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

type DatePreset = { label: string; getValue: () => ReportDateRange };

export const DATE_RANGE_PRESETS: DatePreset[] = [
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
];

function capStrings(values: unknown, max = MAX_ARRAY_LEN): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, max);
}

export function resolveRollingDateRange(
  label: string | undefined,
  storedStart?: string,
  storedEnd?: string
): ReportDateRange {
  if (label === 'All Time') return defaultDateRange();

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
    repairFilter: [],
    selectedState: [],
    selectedCity: [],
    selectedRegion: [],
    selectedAccount: [],
    selectedBranch: [],
    selectedFranchisee: [],
    selectedTechnician: [],
  };

  if (ctx.role === 'branch_manager' && ctx.officeIds.length > 0) {
    shared.selectedBranch = [...ctx.officeIds.map(String)];
  }

  return shared;
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
    selectedOfficeIds: capStrings(stored.selectedOfficeIds),
    selectedCallTypes: capStrings(stored.selectedCallTypes),
    selectedStatus: capStrings(stored.selectedStatus).filter((s) => VALID_STATUS.has(s)),
    priorityFilter: capStrings(stored.priorityFilter).filter((p) => VALID_PRIORITY.has(p)),
    portalFilter: capStrings(stored.portalFilter).filter((p) => VALID_PORTAL.has(p)),
    repairFilter: capStrings(stored.repairFilter).filter(isRepairNcodeValue),
    selectedState: capStrings(stored.selectedState),
    selectedCity: capStrings(stored.selectedCity),
    selectedRegion: capStrings(stored.selectedRegion),
    selectedAccount: capStrings(stored.selectedAccount),
    selectedBranch: capStrings(stored.selectedBranch),
    selectedFranchisee: capStrings(stored.selectedFranchisee),
    selectedTechnician: capStrings(stored.selectedTechnician),
    agingAsOf: stored.agingAsOf
      ? normalizeAgingAsOfDate(stored.agingAsOf)
      : defaultAgingAsOfForRange(dateRange),
  });
}

export function buildDefaultFilterSnapshot(ctx: RestoreFilterContext): ReportFilterSnapshot {
  return storedSharedToSnapshot(buildRoleDefaultShared(ctx));
}
