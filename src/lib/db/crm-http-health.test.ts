import { describe, expect, it, beforeEach } from 'vitest';
import {
  isCrmHttpOverloadStatus,
  noteCrmHttpStatus,
  resetCrmHttpHealthForTests,
} from './crm-http-health';

describe('crm-http-health', () => {
  beforeEach(() => {
    resetCrmHttpHealthForTests();
  });

  it('treats 405/502/503 as overload', () => {
    expect(isCrmHttpOverloadStatus(405)).toBe(true);
    expect(isCrmHttpOverloadStatus(502)).toBe(true);
    expect(isCrmHttpOverloadStatus(503)).toBe(true);
    expect(isCrmHttpOverloadStatus(500)).toBe(false);
    expect(isCrmHttpOverloadStatus(200)).toBe(false);
  });

  it('alerts on first overload then storm at threshold', () => {
    const cfg = { windowMs: 60_000, threshold: 3, alertCooldownMs: 0 };
    const t0 = 1_000_000;
    expect(noteCrmHttpStatus(405, t0, cfg)).toEqual({ first: true, storm: false, count: 1 });
    expect(noteCrmHttpStatus(405, t0 + 1000, cfg)).toEqual({
      first: false,
      storm: false,
      count: 2,
    });
    expect(noteCrmHttpStatus(405, t0 + 2000, cfg)).toEqual({
      first: false,
      storm: true,
      count: 3,
    });
  });

  it('prunes hits outside the window and re-arms first alert', () => {
    const cfg = { windowMs: 10_000, threshold: 3, alertCooldownMs: 0 };
    const t0 = 1_000_000;
    noteCrmHttpStatus(405, t0, cfg);
    noteCrmHttpStatus(405, t0 + 1000, cfg);
    const next = noteCrmHttpStatus(405, t0 + 20_000, cfg);
    expect(next).toEqual({ first: true, storm: false, count: 1 });
  });
});
