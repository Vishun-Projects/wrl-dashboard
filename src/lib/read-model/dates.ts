import { formatLocalDate } from '@/lib/report/filters';

export function formatCrmDateTime(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

export function currentYearStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

export function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatLocalDate(d);
}

export function todayLocalDate(): string {
  return formatLocalDate(new Date());
}

/** Split inclusive date range into 7-day chunks (CRM OOM guard). */
export function splitDateRangeByDays(
  startDate: string,
  endDate: string,
  chunkDays = 7
): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    const chunkStart = formatLocalDate(cursor);
    const chunkEndDate = new Date(cursor);
    chunkEndDate.setDate(chunkEndDate.getDate() + chunkDays - 1);
    if (chunkEndDate > end) chunkEndDate.setTime(end.getTime());
    chunks.push({ start: chunkStart, end: formatLocalDate(chunkEndDate) });
    cursor = new Date(chunkEndDate);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

export function maxCrmWatermarks(rows: Record<string, unknown>[]): {
  lastEditedon: Date | null;
  lastAddedon: Date | null;
} {
  let lastEditedon: Date | null = null;
  let lastAddedon: Date | null = null;

  for (const row of rows) {
    const edited = parseCrmDate(row.editedon ?? row.addedon);
    const added = parseCrmDate(row.addedon);
    if (edited && (!lastEditedon || edited > lastEditedon)) lastEditedon = edited;
    if (added && (!lastAddedon || added > lastAddedon)) lastAddedon = added;
  }

  return { lastEditedon, lastAddedon };
}

export function parseCrmDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function factDateFromLoggedAt(loggedAt: Date): string {
  return formatLocalDate(loggedAt);
}
