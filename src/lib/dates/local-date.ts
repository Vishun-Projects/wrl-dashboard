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

export function toDateString(value: Date | string): string {
  if (value instanceof Date) return formatLocalDate(value);
  return String(value);
}
