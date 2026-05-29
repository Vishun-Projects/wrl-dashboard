import { parseCrmDate } from '@/lib/read-model/dates';

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
  return parseArcpDmYDate(row.dbmapproveddate);
}

export function resolveArcpHoApprovedAt(row: Record<string, unknown>): Date | null {
  return parseArcpDmYDate(row.dhoapproveddate);
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

/** Calendar-day boundaries for ARCP report filters (India operations). */
export const ARCP_REPORT_TIMEZONE =
  process.env.ARCP_REPORT_TIMEZONE?.trim() || 'Asia/Kolkata';

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
