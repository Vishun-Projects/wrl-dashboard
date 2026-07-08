import { describe, expect, it } from 'vitest';
import { MisEmailTimer, formatBytes } from '@/lib/mis-email/timing';

describe('MisEmailTimer', () => {
  it('records step durations', async () => {
    const timer = new MisEmailTimer('test');
    timer.step('first');
    await new Promise((resolve) => setTimeout(resolve, 5));
    timer.step('second');
    const report = timer.finish();
    expect(report.label).toBe('test');
    expect(report.steps).toHaveLength(2);
    expect(report.totalMs).toBeGreaterThanOrEqual(5);
  });

  it('measures async work', async () => {
    const timer = new MisEmailTimer('async-test');
    const value = await timer.measure('work', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return 42;
    });
    expect(value).toBe(42);
    expect(timer.finish().steps[0]?.name).toBe('work');
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
