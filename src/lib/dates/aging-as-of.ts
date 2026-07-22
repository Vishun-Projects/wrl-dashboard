import { formatLocalDate, toDateString } from '@/lib/dates/local-date';

/** Normalize `<input type="date">` or legacy timestamp strings to `YYYY-MM-DD`. */
export function normalizeAgingAsOfDate(value: string | null | undefined): string {
  if (!value?.trim()) return toDateString(new Date());
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return toDateString(d);
  return toDateString(new Date());
}

export function parseLocalDateString(value: string): Date {
  const [y, m, d] = value.split('-').map((part) => Number(part));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function resolveAgingAsOfDate(value: string): Date {
  return endOfLocalDay(parseLocalDateString(normalizeAgingAsOfDate(value)));
}

export { formatLocalDate, toDateString };
