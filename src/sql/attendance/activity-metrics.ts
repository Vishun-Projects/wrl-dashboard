import { distanceMeters } from '@/lib/geo/haversine';
import { parseLatLongString } from '@/lib/geo/parse-latlong';
import type { AttendanceSettings } from '@/modules/attendance/services/org-settings-defaults';

export type IndicationKind = 'normal' | 'distance' | 'time_below';

export type ActivityIndication = {
  kind: IndicationKind;
  label: string;
};

export function toMs(value: Date | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Prefer visit → attend → start → customer latlong text. */
export function pickActivityLatLong(row: {
  visit_start_latlong?: string | null;
  attend_start_latlong?: string | null;
  start_latlong?: string | null;
  customer_latlong?: string | null;
}): string | null {
  const candidates = [
    row.visit_start_latlong,
    row.attend_start_latlong,
    row.start_latlong,
    row.customer_latlong,
  ];
  for (const c of candidates) {
    const t = String(c ?? '').trim();
    if (t && parseLatLongString(t)) return t;
  }
  return null;
}

/** Haversine km between two "lat,lng" strings, or null if either missing/unparseable. */
export function distanceKmBetween(
  fromLatLong: string | null | undefined,
  toLatLong: string | null | undefined
): number | null {
  const a = parseLatLongString(fromLatLong);
  const b = parseLatLongString(toLatLong);
  if (!a || !b) return null;
  const m = distanceMeters(a.lat, a.lng, b.lat, b.lng);
  return Math.round((m / 1000) * 100) / 100;
}

/** Elapsed minutes between two timestamps; null if either missing or end <= start. */
export function elapsedMinutes(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
): number | null {
  const a = toMs(start);
  const b = toMs(end);
  if (a == null || b == null || b <= a) return null;
  return Math.round(((b - a) / 60_000) * 100) / 100;
}

/**
 * CRM day-end close often writes service_meeting_* as 21:30:00 (wall) with start=end.
 * After timestamptz that wall reads as 03:00 IST — do not use it as the live punch time.
 * Prefer activity_date for "when", and service_total_time for duration (Time 2).
 */
export function isDayEndAdjustedMeeting(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
): boolean {
  const a = toMs(start);
  const b = toMs(end);
  if (a == null || b == null || a !== b) return false;
  const d = new Date(a);
  return d.getUTCHours() === 21 && d.getUTCMinutes() === 30;
}

/** @deprecated alias — day-end adjusted close, not invented data */
export const isSentinelMeetingStamp = isDayEndAdjustedMeeting;

export function addMinutes(
  value: Date | string | null | undefined,
  minutes: number
): Date | null {
  const ms = toMs(value);
  if (ms == null || !Number.isFinite(minutes)) return null;
  return new Date(ms + minutes * 60_000);
}

/**
 * Resolve repair start/end for metrics + timeline.
 * - Day-end adjusted: keep both ends on activityDate (CRM closed the day; duration is claimed, not a live span to 3am)
 * - Instant punch (start=end): end = start + service_total_time when present
 * - Real span: keep CRM start/end
 */
export function resolveRepairWindow(input: {
  repairStart: Date | string | null | undefined;
  repairEnd: Date | string | null | undefined;
  activityDate?: Date | string | null | undefined;
  serviceTotalTime?: string | null | undefined;
}): {
  repairStart: Date | string | null;
  repairEnd: Date | string | null;
  timeAdjusted: boolean;
  durationMinutes: number | null;
} {
  const durationMinutes = parseCrmDurationMinutes(input.serviceTotalTime);
  const dayEnd = isDayEndAdjustedMeeting(input.repairStart, input.repairEnd);

  if (dayEnd) {
    // Punch time only — do not add duration onto the clock (that invented overnight "Complete at 3am").
    const punch = input.activityDate ?? null;
    return {
      repairStart: punch,
      repairEnd: punch,
      timeAdjusted: true,
      durationMinutes,
    };
  }

  const start = input.repairStart ?? null;
  const endRaw = input.repairEnd ?? null;
  const startMs = toMs(start);
  const endMs = toMs(endRaw);

  if (startMs != null && endMs != null && endMs > startMs) {
    return {
      repairStart: start,
      repairEnd: endRaw,
      timeAdjusted: false,
      durationMinutes: elapsedMinutes(start, endRaw) ?? durationMinutes,
    };
  }

  // Instant punch (start=end) or missing end — stretch complete by CRM duration text.
  if (startMs != null && durationMinutes != null && durationMinutes > 0) {
    return {
      repairStart: start,
      repairEnd: addMinutes(start, durationMinutes),
      timeAdjusted: false,
      durationMinutes,
    };
  }

  return {
    repairStart: start,
    repairEnd: endRaw ?? start,
    timeAdjusted: false,
    durationMinutes: elapsedMinutes(start, endRaw) ?? durationMinutes,
  };
}

/** Time 3 = Time1 − Time2; null if either missing or result negative. */
export function travelMinutes(
  time1Minutes: number | null,
  time2Minutes: number | null
): number | null {
  if (time1Minutes == null || time2Minutes == null) return null;
  const t3 = Math.round((time1Minutes - time2Minutes) * 100) / 100;
  if (t3 < 0) return null;
  return t3;
}

/**
 * Rough predicted road time for Dist km.
 * Not Maps — ballpark so we can flag waits much longer than the distance needs.
 * Effective speed rises with distance (short = city crawl, longer = highway mix).
 * ponytail: ceiling is “distance-scaled guess”; upgrade = routing API or Thresholds.
 */
export function predictedEffectiveKmh(distanceKm: number): number {
  // ~2 km → ~16–18, ~27 km → ~23 (≈ Maps 1h11), ~80 km → ~38
  return Math.min(38, Math.max(16, 14 + distanceKm * 0.35));
}

/** Short-leg ballpark (kept for callers that pass an explicit flat speed). */
export const PREDICTED_TRAVEL_KMH = 18;

/** @deprecated alias */
export const USUAL_TRAVEL_KMH = PREDICTED_TRAVEL_KMH;

export function expectedTravelMinutes(
  distanceKm: number | null | undefined,
  kmh?: number
): number | null {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0.05) return null;
  const speed =
    kmh != null && Number.isFinite(kmh) && kmh > 0
      ? kmh
      : predictedEffectiveKmh(distanceKm);
  return Math.round((distanceKm / speed) * 60 * 100) / 100;
}

/** ± band around predicted time — capped so we don't show ±1 hr nonsense. */
export function predictedTravelPlusMinusMinutes(
  predictedMinutes: number | null | undefined
): number | null {
  if (predictedMinutes == null || !Number.isFinite(predictedMinutes) || predictedMinutes <= 0) {
    return null;
  }
  return Math.min(20, Math.max(5, Math.round(predictedMinutes * 0.2)));
}

/** Wall-clock wait minus predicted road time; null if either missing. */
export function excessGapMinutes(
  wallGapMinutes: number | null | undefined,
  distanceKm: number | null | undefined,
  kmh?: number
): number | null {
  if (wallGapMinutes == null || !Number.isFinite(wallGapMinutes)) return null;
  const exp = expectedTravelMinutes(distanceKm, kmh);
  if (exp == null) return null;
  const excess = Math.round((wallGapMinutes - exp) * 100) / 100;
  return excess > 0 ? excess : 0;
}

/**
 * Classify prev→current gaps. Keep the minutes (so humans can audit);
 * mark idle when the gap is not plausible continuous travel.
 */
export function sanitizeTravelGap(input: {
  time1Minutes: number | null;
  time3Minutes: number | null;
  distanceKm: number | null;
  minKmh?: number;
  maxPlausibleTravelMinutes?: number;
}): {
  time1Minutes: number | null;
  time3Minutes: number | null;
  idleGap: boolean;
} {
  const minKmh = input.minKmh ?? 8;
  const maxPlausibleTravelMinutes = input.maxPlausibleTravelMinutes ?? 90;
  const time1 = input.time1Minutes;
  const time3 = input.time3Minutes;
  let idleGap = false;

  if (time1 != null && time1 > maxPlausibleTravelMinutes) {
    idleGap = true;
  }

  // Only speed-check real moves — sub-km GPS jitter must not wipe T1.
  if (
    time1 != null &&
    time1 > 0 &&
    input.distanceKm != null &&
    input.distanceKm > 1
  ) {
    const kmh = input.distanceKm / (time1 / 60);
    if (kmh < minKmh) idleGap = true;
  }

  if (time3 != null && time3 > maxPlausibleTravelMinutes) {
    idleGap = true;
  }

  if (
    time3 != null &&
    time3 > 0 &&
    input.distanceKm != null &&
    input.distanceKm > 1
  ) {
    const kmh = input.distanceKm / (time3 / 60);
    if (kmh < minKmh) {
      idleGap = true;
      // Keep the number; travel story is idle-marked in UI.
    }
  }

  // Negative / missing already handled upstream; leave values intact.
  return { time1Minutes: time1, time3Minutes: time3, idleGap };
}

/** Sum typical minutes for semicolon-separated repair-done labels. */
export function approxRepairMinutes(
  repairDone: string | null | undefined,
  typical: Record<string, number>
): number | null {
  const raw = String(repairDone ?? '').trim();
  if (!raw || raw === '—' || raw === '-') return null;
  const parts = raw
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  let sum = 0;
  let matched = 0;
  for (const part of parts) {
    const mins = typical[part];
    if (mins != null && Number.isFinite(mins) && mins > 0) {
      sum += mins;
      matched += 1;
    }
  }
  if (!matched) return null;
  return sum;
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return 'N/A';
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/**
 * Parse CRM duration text into minutes.
 * Accepts: "45", "45 min", "1:15", "01:15:00", "1 hr 15 min", "1h 15m".
 */
export function parseCrmDurationMinutes(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === '—' || s === '-' || s === 'n/a' || s === 'na') return null;

  const hm = s.match(
    /^(\d+)\s*(?:h|hr|hrs|hour|hours)\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/
  );
  if (hm) {
    const h = Number(hm[1]);
    const m = hm[2] != null ? Number(hm[2]) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return null;
    return Math.round((h * 60 + m) * 100) / 100;
  }

  const onlyMin = s.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?$/);
  if (onlyMin && !s.includes(':')) {
    const n = Number(onlyMin[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    // Bare number without unit: treat as minutes when < 24h worth, else minutes still
    return Math.round(n * 100) / 100;
  }

  const colon = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    const c = colon[3] != null ? Number(colon[3]) : null;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b >= 60) return null;
    if (c != null) {
      // HH:MM:SS
      if (!Number.isFinite(c) || c >= 60) return null;
      return Math.round((a * 60 + b + c / 60) * 100) / 100;
    }
    // H:MM or MM:SS — prefer H:MM when first part looks like hours (< 24) or always H:MM for attendance
    return Math.round((a * 60 + b) * 100) / 100;
  }

  return null;
}

export function evaluateIndication(input: {
  distanceKm: number | null;
  approxMinutes: number | null;
  warnDistanceKm: number;
  /** Approx repair does not fit inside time since last. */
  approxExceedsGap?: boolean;
  /** Assumed travel (gap − approx) vs predicted for Dist km. */
  travelMismatch?: 'long' | 'fast' | null;
  expectedTravelMinutes?: number | null;
  excessGapMinutes?: number | null;
  idleGap?: boolean;
}): ActivityIndication {
  const warnings: ActivityIndication[] = [];

  if (input.approxExceedsGap) {
    warnings.push({
      kind: 'time_below',
      label: 'Approx repair longer than time since last',
    });
  }

  if (input.travelMismatch === 'long' && input.expectedTravelMinutes != null) {
    const pred = input.expectedTravelMinutes;
    const band = predictedTravelPlusMinusMinutes(pred);
    const label =
      pred > 120 || band == null
        ? `Travel longer than predicted (around ${formatDurationMinutes(pred)})`
        : `Travel longer than predicted (around ${formatDurationMinutes(pred)} ± ${formatDurationMinutes(band)})`;
    warnings.push({ kind: 'distance', label });
  } else if (input.travelMismatch === 'fast' && input.expectedTravelMinutes != null) {
    const pred = input.expectedTravelMinutes;
    const band = predictedTravelPlusMinusMinutes(pred);
    const label =
      band == null
        ? `Travel faster than predicted (around ${formatDurationMinutes(pred)})`
        : `Travel faster than predicted (around ${formatDurationMinutes(pred)} ± ${formatDurationMinutes(band)})`;
    warnings.push({ kind: 'time_below', label });
  } else if (
    input.distanceKm != null &&
    Number.isFinite(input.distanceKm) &&
    input.distanceKm > input.warnDistanceKm
  ) {
    warnings.push({
      kind: 'distance',
      label: input.idleGap
        ? `Farther than ${input.warnDistanceKm} km from last call`
        : `Distance over ${input.warnDistanceKm} km`,
    });
  }

  if (warnings[0]) return warnings[0]!;
  return { kind: 'normal', label: 'Normal' };
}

export type ActivityCalcInput = {
  latlong: string | null;
  prevLatlong: string | null;
  actStart: Date | string | null;
  prevActStart: Date | string | null;
  repairStart: Date | string | null;
  repairEnd: Date | string | null;
  activityDate?: Date | string | null;
  /** CRM text duration — kept for CRM compare / day-end detect only. */
  serviceTotalTime?: string | null;
  travelStart?: Date | string | null;
  travelEnd?: Date | string | null;
  travelTotalTime?: string | null;
  repairDone: string | null;
  settings: AttendanceSettings;
  /** Dist km from trdcalls10ARCP.ndistance for this call — not GPS haversine. */
  distanceKm?: number | null;
};

export type ActivityCalcResult = {
  distanceKm: number | null;
  time1Minutes: number | null;
  time2Minutes: number | null;
  time3Minutes: number | null;
  approxMinutes: number | null;
  indication: ActivityIndication;
  timeAdjusted?: boolean;
  idleGap?: boolean;
  expectedTravelMinutes?: number | null;
  excessGapMinutes?: number | null;
};

/**
 * Split wall-clock gap using manager Approx:
 *   T1 = since last activity
 *   T2 = Approx (assumed repair / on-site)
 *   T3 = T1 − T2 (assumed travel) → check vs predicted road time for Dist km
 * CRM Start/Complete are the same punch — do not use their span as repair length.
 */
export function calculateActivityMetrics(input: ActivityCalcInput): ActivityCalcResult {
  const window = resolveRepairWindow({
    repairStart: input.repairStart,
    repairEnd: input.repairEnd,
    activityDate: input.activityDate,
    serviceTotalTime: input.serviceTotalTime,
  });

  const distanceKm =
    input.distanceKm != null && Number.isFinite(input.distanceKm)
      ? Math.round(input.distanceKm * 100) / 100
      : null;
  const time1Minutes = elapsedMinutes(input.prevActStart, input.actStart);
  const approxMinutes = approxRepairMinutes(
    input.repairDone,
    input.settings.repairDoneTypicalMinutes
  );

  let time2Minutes: number | null = null;
  let time3Minutes: number | null = null;
  let approxExceedsGap = false;

  if (approxMinutes != null) {
    time2Minutes = approxMinutes;
    if (time1Minutes != null) {
      if (time1Minutes >= approxMinutes) {
        time3Minutes = Math.round((time1Minutes - approxMinutes) * 100) / 100;
      } else {
        approxExceedsGap = true;
      }
    }
  } else {
    // No Approx set — fall back to CRM travel punches only (cannot split the gap).
    time3Minutes =
      elapsedMinutes(input.travelStart, input.travelEnd) ??
      parseCrmDurationMinutes(input.travelTotalTime);
  }

  const expectedMins = expectedTravelMinutes(distanceKm);
  const band = predictedTravelPlusMinusMinutes(expectedMins);

  let travelMismatch: 'long' | 'fast' | null = null;
  let excessMins: number | null = null;
  if (time3Minutes != null && expectedMins != null && band != null) {
    if (time3Minutes > expectedMins + band) {
      travelMismatch = 'long';
      excessMins = Math.round((time3Minutes - expectedMins) * 100) / 100;
    } else if (
      distanceKm != null &&
      distanceKm > 1 &&
      time3Minutes < Math.max(0, expectedMins - band)
    ) {
      travelMismatch = 'fast';
    }
  }

  let idleGap = false;
  if (time3Minutes != null) {
    const cleaned = sanitizeTravelGap({
      time1Minutes: time3Minutes,
      time3Minutes,
      distanceKm,
    });
    idleGap = cleaned.idleGap;
  } else if (time1Minutes != null && approxMinutes == null) {
    const cleaned = sanitizeTravelGap({
      time1Minutes,
      time3Minutes: null,
      distanceKm,
    });
    idleGap = cleaned.idleGap;
  }

  const indication = evaluateIndication({
    distanceKm,
    approxMinutes,
    warnDistanceKm: input.settings.warnDistanceKm,
    approxExceedsGap,
    travelMismatch,
    expectedTravelMinutes: expectedMins,
    excessGapMinutes: excessMins,
    idleGap,
  });

  return {
    distanceKm,
    time1Minutes,
    time2Minutes,
    time3Minutes,
    approxMinutes,
    indication,
    timeAdjusted: window.timeAdjusted,
    idleGap,
    expectedTravelMinutes: expectedMins,
    excessGapMinutes: travelMismatch === 'long' ? excessMins : null,
  };
}
