/** Calendar date YYYY-MM-DD in Asia/Kolkata — avoids UTC shift when running on UTC server (e.g. IST early morning). */
export function formatLocalDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

export function todayIst(): string {
  return formatLocalDate(new Date());
}

export function toDateString(value: Date | string): string {
  if (value instanceof Date) return formatLocalDate(value);
  return String(value);
}
