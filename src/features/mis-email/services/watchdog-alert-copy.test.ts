import { describe, expect, it } from 'vitest';
import {
  applyWatchdogPlaceholders,
  formatWatchdogAlert,
} from '@/features/mis-email/services/watchdog-alert-copy';

describe('applyWatchdogPlaceholders', () => {
  it('replaces date and reason', () => {
    expect(
      applyWatchdogPlaceholders('On {date}: {reason} ({date})', {
        date: '2026-07-31',
        reason: 'no complete',
      })
    ).toBe('On 2026-07-31: no complete (2026-07-31)');
  });
});

describe('formatWatchdogAlert', () => {
  it('formats subject and body', () => {
    const out = formatWatchdogAlert({
      subjectTemplate: 'Attention ({date})',
      bodyTemplate: 'Hello\n\n{reason}\n\nDate: {date}',
      date: '2026-07-31',
      reason: 'Digest incomplete',
    });
    expect(out.subject).toBe('Attention (2026-07-31)');
    expect(out.body).toBe('Hello\n\nDigest incomplete\n\nDate: 2026-07-31');
  });
});
