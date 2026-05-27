import { daysAgoDate, todayLocalDate } from '@/lib/read-model/dates';
import { formatLocalDate } from '@/lib/report-filters';

/** Matches backfill hot window in sync worker (rolling 90 days). */
export const HOT_WINDOW_DAYS = 90;

export type DateRange = { start: string; end: string };

export type HotWindowCoverage =
  | { mode: 'postgres'; postgres: DateRange }
  | { mode: 'crm'; crm: DateRange }
  | { mode: 'hybrid'; postgres: DateRange; crm: DateRange[] };

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return formatLocalDate(d);
}

function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return formatLocalDate(d);
}

export function hotWindowRange(): DateRange {
  return {
    start: daysAgoDate(HOT_WINDOW_DAYS),
    end: todayLocalDate(),
  };
}

/**
 * Decide whether a user date range is served from Supabase hot table, CRM, or both.
 * Hot table holds ~90 days of calls (+ open-old exceptions stored without date clip).
 */
export function resolveHotWindowCoverage(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): HotWindowCoverage {
  const hot = hotWindowRange();

  if (!startDate || !endDate) {
    return { mode: 'postgres', postgres: hot };
  }

  if (endDate < hot.start) {
    return { mode: 'crm', crm: { start: startDate, end: endDate } };
  }

  if (startDate > hot.end) {
    return { mode: 'crm', crm: { start: startDate, end: endDate } };
  }

  if (startDate >= hot.start && endDate <= hot.end) {
    return { mode: 'postgres', postgres: { start: startDate, end: endDate } };
  }

  const crm: DateRange[] = [];
  if (startDate < hot.start) {
    crm.push({ start: startDate, end: dayBefore(hot.start) });
  }
  if (endDate > hot.end) {
    crm.push({ start: dayAfter(hot.end), end: endDate });
  }

  return {
    mode: 'hybrid',
    postgres: {
      start: startDate < hot.start ? hot.start : startDate,
      end: endDate > hot.end ? hot.end : endDate,
    },
    crm,
  };
}

export function isWithinHotWindow(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): boolean {
  return resolveHotWindowCoverage(startDate, endDate).mode === 'postgres';
}
