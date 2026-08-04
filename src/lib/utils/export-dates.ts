/** Default timezone for export date columns (India operations). */
export const EXPORT_DATE_TIMEZONE =
  process.env.EXPORT_DATE_TIMEZONE?.trim() || 'Asia/Kolkata';

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
    if (!trimmed || trimmed === '-' || trimmed === '0') return '';

    const dotted = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (dotted) {
      const base = formatDmyDots(dotted[1], dotted[2], dotted[3]);
      if (dotted[4] != null && dotted[5] != null) {
        return `${base} ${pad2(Number(dotted[4]))}:${dotted[5]}`;
      }
      return base;
    }

    const slashOrDash = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (slashOrDash) {
      const base = formatDmyDots(slashOrDash[1], slashOrDash[2], slashOrDash[3]);
      if (slashOrDash[4] != null && slashOrDash[5] != null) {
        return `${base} ${pad2(Number(slashOrDash[4]))}:${slashOrDash[5]}`;
      }
      return base;
    }

    const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      return formatDmyDots(isoDateOnly[3], isoDateOnly[2], isoDateOnly[1]);
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
