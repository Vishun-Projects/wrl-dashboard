/** Calendar date YYYY-MM-DD in Asia/Kolkata — avoids UTC shift when running on UTC server (e.g. IST early morning). */
export function formatLocalDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

export function todayIst(): string {
  return formatLocalDate(new Date());
}

/** Previous calendar day in Asia/Kolkata (YYYY-MM-DD). */
export function yesterdayIst(): string {
  const [y, m, d] = todayIst().split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** First day of the current IST calendar month (YYYY-MM-DD). */
export function monthStartIst(day = todayIst()): string {
  const [y, m] = day.split('-');
  return `${y}-${m}-01`;
}

/**
 * Call Register / MIS report date chips are IST calendar days (Western CRM).
 * Naive `T00:00:00` without offset is UTC on the VPS and drops early-IST rows.
 */
export const REPORT_IST_OFFSET = '+05:30';

export function istDayStartIso(ymd: string): string {
  return `${ymd}T00:00:00${REPORT_IST_OFFSET}`;
}

export function istDayEndIso(ymd: string): string {
  return `${ymd}T23:59:59.999${REPORT_IST_OFFSET}`;
}

export function toDateString(value: Date | string): string {
  if (value instanceof Date) return formatLocalDate(value);
  return String(value);
}
