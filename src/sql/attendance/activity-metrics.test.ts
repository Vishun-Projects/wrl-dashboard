import { describe, expect, it } from 'vitest';
import {
  approxRepairMinutes,
  calculateActivityMetrics,
  distanceKmBetween,
  elapsedMinutes,
  evaluateIndication,
  expectedTravelMinutes,
  formatDurationMinutes,
  parseCrmDurationMinutes,
  predictedTravelPlusMinusMinutes,
  resolveRepairWindow,
  toMs,
  travelMinutes,
} from './activity-metrics';
import { ATTENDANCE_ORG_SETTINGS_FALLBACKS } from '@/modules/attendance/services/org-settings-defaults';

const settings = {
  ...ATTENDANCE_ORG_SETTINGS_FALLBACKS,
  repairDoneTypicalMinutes: {
    ...ATTENDANCE_ORG_SETTINGS_FALLBACKS.repairDoneTypicalMinutes,
    'Compressor Replaced': 120,
  },
};

describe('activity-metrics', () => {
  it('predicted road time scales with distance (short city vs longer hop)', () => {
    const short = expectedTravelMinutes(2.27);
    expect(short).not.toBeNull();
    expect(short!).toBeGreaterThanOrEqual(7);
    expect(short!).toBeLessThanOrEqual(10);

    const mid = expectedTravelMinutes(26.53);
    expect(mid).not.toBeNull();
    expect(mid!).toBeGreaterThanOrEqual(60);
    expect(mid!).toBeLessThanOrEqual(80);
  });

  it('predicted ± band is ~20% capped at 20 min', () => {
    expect(predictedTravelPlusMinusMinutes(8)).toBe(5);
    expect(predictedTravelPlusMinusMinutes(44)).toBe(9);
    expect(predictedTravelPlusMinusMinutes(276)).toBe(20);
  });

  it('returns N/A path when GPS missing', () => {
    expect(distanceKmBetween(null, '17.38,78.48')).toBeNull();
    expect(distanceKmBetween('17.38,78.48', '')).toBeNull();
  });

  it('computes distance between two points in km', () => {
    const km = distanceKmBetween('17.3850,78.4867', '17.4401,78.3489');
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(10);
    expect(km!).toBeLessThan(30);
  });

  it('Time1 N/A without previous; travelMinutes helper still works', () => {
    expect(elapsedMinutes(null, '2026-05-16T11:00:00+05:30')).toBeNull();
    expect(travelMinutes(30, 45)).toBeNull();
    expect(travelMinutes(90, 45)).toBe(45);
  });

  it('sums approx minutes across repair-done types', () => {
    expect(
      approxRepairMinutes('Motor Replaced; Gas Charging Done', {
        'Motor Replaced': 60,
        'Gas Charging Done': 45,
      })
    ).toBe(105);
    expect(
      approxRepairMinutes('Unknown', ATTENDANCE_ORG_SETTINGS_FALLBACKS.repairDoneTypicalMinutes)
    ).toBeNull();
  });

  it('flags travel mismatch and approx-exceeds-gap', () => {
    expect(
      evaluateIndication({
        distanceKm: 62,
        approxMinutes: 90,
        warnDistanceKm: 50,
      }).kind
    ).toBe('distance');

    expect(
      evaluateIndication({
        distanceKm: 12,
        approxMinutes: 120,
        warnDistanceKm: 50,
        approxExceedsGap: true,
      }).label
    ).toBe('Approx repair longer than time since last');

    expect(
      evaluateIndication({
        distanceKm: 12,
        approxMinutes: 120,
        warnDistanceKm: 50,
        travelMismatch: 'long',
        expectedTravelMinutes: 40,
        excessGapMinutes: 100,
      }).label
    ).toMatch(/Travel longer than predicted/);

    expect(
      evaluateIndication({
        distanceKm: 12,
        approxMinutes: 30,
        warnDistanceKm: 50,
        travelMismatch: 'fast',
        expectedTravelMinutes: 40,
      }).label
    ).toMatch(/Travel faster than predicted/);
  });

  it('splits gap: Approx → T2, remainder → T3 travel check', () => {
    // Gap 4.5 hr, compressor approx 2 hr → travel 2.5 hr over a short hop → long travel
    const calc = calculateActivityMetrics({
      latlong: '17.4401,78.3489',
      prevLatlong: '17.3850,78.4867',
      actStart: '2026-05-16T14:30:00+05:30',
      prevActStart: '2026-05-16T10:00:00+05:30',
      repairStart: '2026-05-16T14:30:00+05:30',
      repairEnd: '2026-05-16T14:30:00+05:30',
      serviceTotalTime: '00:02',
      repairDone: 'Compressor Replaced',
      settings,
      distanceKm: 12,
    });
    expect(calc.time1Minutes).toBe(270);
    expect(calc.time2Minutes).toBe(120);
    expect(calc.time3Minutes).toBe(150);
    expect(calc.approxMinutes).toBe(120);
    expect(calc.distanceKm).toBe(12);
    expect(calc.indication.label).toMatch(/Travel longer than predicted/);
  });

  it('ignores CRM service_total_time for T2 when Approx is set', () => {
    expect(parseCrmDurationMinutes('0:45')).toBe(45);
    const calc = calculateActivityMetrics({
      latlong: '17.4401,78.3489',
      prevLatlong: '17.3850,78.4867',
      actStart: '2026-05-16T12:00:00+05:30',
      prevActStart: '2026-05-16T10:00:00+05:30',
      repairStart: null,
      repairEnd: null,
      serviceTotalTime: '0:45',
      repairDone: 'Compressor Replaced',
      settings,
      distanceKm: 10,
    });
    expect(calc.time1Minutes).toBe(120);
    expect(calc.time2Minutes).toBe(120);
    expect(calc.time3Minutes).toBe(0);
  });

  it('without Approx: T2 N/A and no gap split', () => {
    const calc = calculateActivityMetrics({
      latlong: '9.497393,76.3466023',
      prevLatlong: '9.2009656,76.5973776',
      actStart: '2026-01-26T23:37:00+05:30',
      prevActStart: '2026-01-26T16:09:00+05:30',
      repairStart: '2026-01-26T23:37:00+05:30',
      repairEnd: '2026-01-26T23:39:00+05:30',
      repairDone: null,
      settings,
      distanceKm: 40,
    });
    expect(calc.time2Minutes).toBeNull();
    expect(calc.time1Minutes).toBeGreaterThan(400);
    expect(calc.approxMinutes).toBeNull();
    expect(calc.distanceKm).toBe(40);
  });

  it('uses ARCP ndistance (not GPS) and flags long assumed travel', () => {
    const calc = calculateActivityMetrics({
      latlong: null,
      prevLatlong: null,
      actStart: '2026-08-25T23:30:00+05:30',
      prevActStart: '2026-08-25T16:15:00+05:30',
      repairStart: '2026-08-25T23:30:00+05:30',
      repairEnd: '2026-08-25T23:30:00+05:30',
      serviceTotalTime: '00:03',
      repairDone: 'Compressor Replaced',
      settings,
      distanceKm: 80,
    });
    expect(calc.distanceKm).toBe(80);
    expect(calc.time2Minutes).toBe(120);
    expect(calc.time3Minutes).not.toBeNull();
    expect(calc.time3Minutes!).toBeGreaterThan(200);
    expect(calc.indication.label).toMatch(/Travel longer than predicted/);
  });

  it('Dist km stays N/A when ARCP distance missing (no GPS fallback)', () => {
    const calc = calculateActivityMetrics({
      latlong: '23.1776472,79.9411303',
      prevLatlong: '23.8057342,80.3756444',
      actStart: '2026-08-25T23:30:00+05:30',
      prevActStart: '2026-08-25T16:15:00+05:30',
      repairStart: '2026-08-25T23:30:00+05:30',
      repairEnd: '2026-08-25T23:30:00+05:30',
      repairDone: 'Compressor Replaced',
      settings,
    });
    expect(calc.distanceKm).toBeNull();
  });

  it('day-end adjusted still one punch; Approx drives T2 when set', () => {
    const calc = calculateActivityMetrics({
      latlong: '26.23823,82.1068133',
      prevLatlong: '26.8217612,80.8702783',
      actStart: '2026-01-01T20:39:36+05:30',
      prevActStart: '2026-01-01T15:33:17+05:30',
      repairStart: '2026-01-01T21:30:00.000Z',
      repairEnd: '2026-01-01T21:30:00.000Z',
      activityDate: '2026-01-01T20:39:36+05:30',
      serviceTotalTime: '06:21',
      repairDone: null,
      settings,
    });
    expect(calc.timeAdjusted).toBe(true);
    expect(calc.time2Minutes).toBeNull();

    const win = resolveRepairWindow({
      repairStart: '2026-01-01T21:30:00.000Z',
      repairEnd: '2026-01-01T21:30:00.000Z',
      activityDate: '2026-01-01T23:46:20+05:30',
      serviceTotalTime: '03:14',
    });
    expect(win.timeAdjusted).toBe(true);
    expect(toMs(win.repairStart)).toBe(toMs(win.repairEnd));
  });

  it('formats durations', () => {
    expect(formatDurationMinutes(null)).toBe('N/A');
    expect(formatDurationMinutes(45)).toBe('45 min');
    expect(formatDurationMinutes(90)).toBe('1 hr 30 min');
  });
});
