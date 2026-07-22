import { formatLocalDate } from '@/lib/dates/local-date';

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

/** Split inclusive date range into N-day chunks (CRM OOM/timeout guard). */
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

/** Split one calendar day into hour windows for CRM SQL timeout recovery. */
export function splitDayByHours(
  date: string,
  hoursPerChunk = Number(process.env.SYNC_CRM_HOUR_CHUNK_SIZE ?? 6) || 6
): Array<{ startDateTime: string; endDateTime: string }> {
  const step = Math.max(1, Math.min(24, hoursPerChunk));
  const chunks: Array<{ startDateTime: string; endDateTime: string }> = [];
  for (let hour = 0; hour < 24; hour += step) {
    const endHour = Math.min(hour + step, 24);
    const endMinute = endHour >= 24 ? '59:59' : '59:59';
    const endHourClamped = endHour >= 24 ? 23 : endHour - 1;
    chunks.push({
      startDateTime: `${date} ${String(hour).padStart(2, '0')}:00:00`,
      endDateTime: `${date} ${String(endHourClamped).padStart(2, '0')}:${endMinute}`,
    });
  }
  return chunks;
}

export function endOfLocalDate(date: string): Date {
  const d = new Date(`${date}T23:59:59`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
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

  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function factDateFromLoggedAt(loggedAt: Date): string {
  return formatLocalDate(loggedAt);
}
