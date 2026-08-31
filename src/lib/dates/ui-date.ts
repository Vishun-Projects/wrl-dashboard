/** UI timezone for on-screen dates (India operations). */
export const UI_DATE_TIMEZONE =
  process.env.EXPORT_DATE_TIMEZONE?.trim() || 'Asia/Kolkata';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDmySlash(day: string, month: string, year: string): string {
  return `${pad2(Number(day))}/${pad2(Number(month))}/${year}`;
}

function partsInZone(
  d: Date,
  withTime: boolean
): { day: string; month: string; year: string; hour?: string; minute?: string } | null {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: UI_DATE_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  };
  if (withTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
    opts.hourCycle = 'h23';
  }
  const parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const day = pick('day');
  const month = pick('month');
  const year = pick('year');
  if (!day || !month || !year) return null;
  if (!withTime) return { day, month, year };
  return { day, month, year, hour: pick('hour'), minute: pick('minute') };
}

/**
 * Parse common CRM / ISO / slash date strings without relying on `new Date('dd/mm/yyyy')`
 * (which is locale-ambiguous). Returns null when not a plain calendar string.
 */
function parseCalendarString(
  trimmed: string
): { day: string; month: string; year: string; hour?: string; minute?: string } | null {
  if (!trimmed || trimmed === '-' || trimmed === '0') return null;

  const dotted = trimmed.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/
  );
  if (dotted) {
    return {
      day: dotted[1],
      month: dotted[2],
      year: dotted[3],
      hour: dotted[4],
      minute: dotted[5],
    };
  }

  const slashOrDash = trimmed.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/
  );
  if (slashOrDash) {
    return {
      day: slashOrDash[1],
      month: slashOrDash[2],
      year: slashOrDash[3],
      hour: slashOrDash[4],
      minute: slashOrDash[5],
    };
  }

  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    return {
      day: isoDateOnly[3],
      month: isoDateOnly[2],
      year: isoDateOnly[1],
    };
  }

  // ISO with time/offset → leave to Date + timezone formatting (not raw UTC digits)
  return null;
}

/** On-screen dates: dd/mm/yyyy (e.g. 14/11/2025). Empty / invalid → ''. */
export function formatUiDate(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const cal = parseCalendarString(trimmed);
    if (cal) return formatDmySlash(cal.day, cal.month, cal.year);
  }

  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';

  const parts = partsInZone(d, false);
  if (!parts) return '';
  return formatDmySlash(parts.day, parts.month, parts.year);
}

/** On-screen dates: dd-mm-yyyy (e.g. 14-11-2025). Empty / invalid → ''. */
export function formatUiDateDash(value: unknown): string {
  const s = formatUiDate(value);
  return s ? s.replace(/\//g, '-') : '';
}

/** On-screen date+time: dd/mm/yyyy HH:mm. Empty / invalid → ''. */
export function formatUiDateTime(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const cal = parseCalendarString(trimmed);
    if (cal) {
      const base = formatDmySlash(cal.day, cal.month, cal.year);
      if (cal.hour != null && cal.minute != null) {
        return `${base} ${pad2(Number(cal.hour))}:${pad2(Number(cal.minute))}`;
      }
      // Date-only string with no clock → still date-only (no fake midnight)
      return base;
    }
  }

  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';

  const parts = partsInZone(d, true);
  if (!parts || parts.hour == null || parts.minute == null) return formatUiDate(d);
  return `${formatDmySlash(parts.day, parts.month, parts.year)} ${pad2(Number(parts.hour))}:${pad2(Number(parts.minute))}`;
}
