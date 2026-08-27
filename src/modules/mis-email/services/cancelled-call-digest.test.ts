import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/modules/mis-email/services/org-settings', () => ({
  getMisEmailOrgSettings: vi.fn(async () => ({
    cancelledCallDigestSendTimeIst: '09:00',
  })),
}));

vi.mock('@/modules/mis-email/services/preferences', () => ({
  shouldSendMisEmailNow: vi.fn(() => false),
}));

vi.mock('@/modules/mis-email/server/sync/cancelled-call-digest-recipients', () => ({
  ensureCancelledCallDigestTables: vi.fn(),
  listEnabledCancelledDigestEmailsForBranch: vi.fn(),
  recordCancelledDigestSent: vi.fn(),
  wasCancelledDigestAlreadySent: vi.fn(),
}));

vi.mock('@/modules/cancelled-calls/server/query', () => ({
  fetchCancelledCallsForDigestDay: vi.fn(async () => new Map()),
  istYesterdayYmd: () => '2026-08-26',
}));

import { shouldSendMisEmailNow } from '@/modules/mis-email/services/preferences';
import { runCancelledCallDigest } from '@/modules/mis-email/services/cancelled-call-digest';

describe('runCancelledCallDigest schedule gate', () => {
  beforeEach(() => {
    vi.mocked(shouldSendMisEmailNow).mockReturnValue(false);
  });

  it('skips when outside send window (cron path)', async () => {
    const result = await runCancelledCallDigest();
    expect(result.skipped).toEqual([
      { branch: '*', reason: 'outside_send_window', rowCount: 0 },
    ]);
  });

  it('force bypasses schedule gate', async () => {
    const result = await runCancelledCallDigest({ force: true });
    expect(result.skipped.some((s) => s.reason === 'outside_send_window')).toBe(false);
  });
});
