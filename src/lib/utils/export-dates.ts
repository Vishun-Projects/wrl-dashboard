import { parseCalendarString, UI_DATE_TIMEZONE } from '@/lib/dates/ui-date';

/** Default timezone for export date columns (India operations). */
export const EXPORT_DATE_TIMEZONE = UI_DATE_TIMEZONE;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDmyDots(day: string, month: string, year: string): string {
  return `${pad2(Number(day))}.${pad2(Number(month))}.${year}`;
}

/** Export cells use dots (DD.MM.YYYY); UI dates use slashes. */
export function formatExportDate(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const cal = parseCalendarString(trimmed);
    if (cal) {
      const base = formatDmyDots(cal.day, cal.month, cal.year);
      if (cal.hour != null && cal.minute != null) {
        return `${base} ${pad2(Number(cal.hour))}:${pad2(Number(cal.minute))}`;
      }
      return base;
    }
  }

  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    return typeof value === 'string' ? value.trim() : String(value);
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: EXPORT_DATE_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const day = pick('day');
  const month = pick('month');
  const year = pick('year');
  if (!day || !month || !year) return String(value);

  return formatDmyDots(day, month, year);
}
