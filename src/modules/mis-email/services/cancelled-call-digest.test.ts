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
  listCancelledCallDigestRecipients: vi.fn(async () => []),
  recordCancelledDigestSent: vi.fn(),
  wasCancelledDigestAlreadySent: vi.fn(),
}));

vi.mock('@/modules/mis-email/services/send', () => ({
  sendPreparedDigestEmail: vi.fn(async () => ({ messageId: 'msg-1' })),
}));

vi.mock('@/modules/mis/services/summary-excel-export', () => ({
  workbookToBuffer: vi.fn(async () => Buffer.from('xlsx')),
}));

vi.mock('@/modules/cancelled-calls/server/excel-export', () => ({
  buildCancelledCallsWorkbook: vi.fn(async () => ({})),
  cancelledCallsOverview: vi.fn(() => []),
  cancelledCallsWorkbookFilename: (date: string) => `WRL_Cancelled_Calls_${date}.xlsx`,
}));

vi.mock('@/modules/cancelled-calls/server/query', () => ({
  fetchCancelledCallsForDigestDay: vi.fn(async () => new Map()),
  istYesterdayYmd: () => '2026-08-26',
}));

import { shouldSendMisEmailNow } from '@/modules/mis-email/services/preferences';
import { fetchCancelledCallsForDigestDay } from '@/modules/cancelled-calls';
import { sendPreparedDigestEmail } from '@/modules/mis-email/services/send';
import { runCancelledCallDigest } from '@/modules/mis-email/services/cancelled-call-digest';
import type { CancelledCallRow } from '@/modules/cancelled-calls/types';

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

  it('sends one consolidated mail per forceTo recipient', async () => {
    const sampleRow = {
      vtrnno: '26C00001',
      ncode: 1,
      ncancelreason: 1,
      cancelReason: 'Test',
      cancelledAt: '2026-08-31T10:00:00+05:30',
      loggedAt: '2026-08-30T10:00:00+05:30',
      callType: 'BD',
      branchName: 'Mumbai',
      franchiseeName: null,
      franchiseeVendorCode: null,
      partyName: 'Party',
      partyProfile: null,
      itemCode: null,
      serial: null,
      complaint: null,
      region: null,
    } satisfies CancelledCallRow;

    vi.mocked(fetchCancelledCallsForDigestDay).mockResolvedValue(
      new Map([
        ['Mumbai', [sampleRow]],
        ['Delhi', [{ ...sampleRow, branchName: 'Delhi', vtrnno: '26C00002' }]],
      ])
    );

    const result = await runCancelledCallDigest({
      force: true,
      forceTo: 'ops@example.com',
    });

    expect(sendPreparedDigestEmail).toHaveBeenCalledTimes(1);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]?.to).toEqual(['ops@example.com']);
    expect(result.sent[0]?.rowCount).toBe(2);
    expect(result.sent[0]?.branch).toContain('Mumbai');
    expect(result.sent[0]?.branch).toContain('Delhi');
  });
});
