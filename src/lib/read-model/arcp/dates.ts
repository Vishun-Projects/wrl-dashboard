import { parseCrmDate } from '@/lib/read-model/dates';

/** Calendar-day boundaries for ARCP report filters (India operations). */
export const ARCP_REPORT_TIMEZONE =
  process.env.ARCP_REPORT_TIMEZONE?.trim() || 'Asia/Kolkata';

function isTruthyCrmFlag(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function hasPositiveAmount(value: unknown): boolean {
  if (value == null || value === '') return false;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0;
}

/** Parse BM/HO approve columns (dd/mm/yyyy text, ISO, or CRM datetime strings). */
export function parseArcpDmYDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw || raw === '-' || raw === '0') return null;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    const year = Number(slash[3]);
    const h = Number(slash[4] ?? 0);
    const min = Number(slash[5] ?? 0);
    const s = Number(slash[6] ?? 0);
    const hasTime = slash[4] != null;
    const d = hasTime
      ? new Date(year, month, day, h, min, s)
      : new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const dashDmy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dashDmy) {
    const day = Number(dashDmy[1]);
    const month = Number(dashDmy[2]) - 1;
    const year = Number(dashDmy[3]);
    const hasTime = dashDmy[4] != null;
    const d = hasTime
      ? new Date(year, month, day, Number(dashDmy[4]), Number(dashDmy[5] ?? 0))
      : new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 0, 0, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return parseCrmDate(value);
}

export function resolveArcpBmApprovedAt(row: Record<string, unknown>): Date | null {
  const fromBmColumn = parseArcpDmYDate(row.dbmapproveddate);
  if (fromBmColumn) return fromBmColumn;

  const fromApproval1 =
    parseCrmDate(row.dapproval1on) ?? parseArcpDmYDate(row.dapproval1on);
  const bmMarked =
    isTruthyCrmFlag(row.bapproved) ||
    hasPositiveAmount(row.nbmapprovedamt) ||
    hasPositiveAmount(row.napproval1amount);
  if (fromApproval1 && bmMarked) return fromApproval1;

  return null;
}

export function resolveArcpHoApprovedAt(row: Record<string, unknown>): Date | null {
  const fromHoColumn = parseArcpDmYDate(row.dhoapproveddate);
  if (fromHoColumn) return fromHoColumn;

  const fromApproval2 =
    parseCrmDate(row.dapproval2on) ?? parseArcpDmYDate(row.dapproval2on);
  const hoMarked =
    isTruthyCrmFlag(row.bapprovedho) ||
    hasPositiveAmount(row.nhoapprovedamt) ||
    hasPositiveAmount(row.napproval2amount);
  if (fromApproval2 && hoMarked) return fromApproval2;

  return null;
}

export function claimMonthFromDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Effective approve date for filtering — same as CRM COALESCE(HO, BM). */
export function resolveArcpApproveAt(row: Record<string, unknown>): Date | null {
  const ho = resolveArcpHoApprovedAt(row);
  const bm = resolveArcpBmApprovedAt(row);
  return ho ?? bm ?? null;
}

export const ARCP_APPROVE_EFFECTIVE_SQL = 'COALESCE(ho_approved_at, bm_approved_at)';

/** Detail CSV / Excel — dd/MM/yyyy HH:mm in report timezone (not ISO Z). */
export function formatArcpClaimsExportDate(value: unknown): string {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  if (!raw || raw === '-' || raw === '0') return '';
  if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(raw)) return raw;

  const d = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ARCP_REPORT_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const day = pick('day');
  const month = pick('month');
  const year = pick('year');
  const hour = pick('hour');
  const minute = pick('minute');
  if (!day || !month || !year) return raw;
  if (hour && minute) return `${day}/${month}/${year} ${hour}:${minute}`;
  return `${day}/${month}/${year}`;
}

export function arcpBackfillYears(): number {
  const n = Number(process.env.ARCP_BACKFILL_YEARS ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** First call-log date to load. Prefer ARCP_BACKFILL_START_DATE (e.g. 2025-01-01). */
export function arcpBackfillStartDate(): string {
  const explicit = process.env.ARCP_BACKFILL_START_DATE?.trim();
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
    return explicit;
  }
  const years = arcpBackfillYears();
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(0);
  d.setDate(1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
