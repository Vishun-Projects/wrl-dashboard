import { beforeEach, describe, expect, it, vi } from 'vitest';

const priorityRefreshHotFromCrm = vi.fn();
const postQuery = vi.fn();
const withClient = vi.fn();
const sendMail = vi.fn();
const logAction = vi.fn();
const assertOrgOutboundMailEnabled = vi.fn();
const getMisEmailOrgSettings = vi.fn();
const listEnabledEmailsForBranch = vi.fn();
const isSmtpConfigured = vi.fn();
const resolveSmtpConfig = vi.fn();
const createMailTransport = vi.fn();

vi.mock('@/lib/read-model/priority-refresh-trns', async () => {
  const actual = await vi.importActual<typeof import('@/lib/read-model/priority-refresh-trns')>(
    '@/lib/read-model/priority-refresh-trns'
  );
  return {
    ...actual,
    priorityRefreshHotFromCrm: (...args: unknown[]) => priorityRefreshHotFromCrm(...args),
  };
});
vi.mock('@/lib/db/proxy', () => ({
  postQuery: (...args: unknown[]) => postQuery(...args),
}));
vi.mock('@/lib/read-model/db', () => ({
  withClient: (fn: (client: unknown) => unknown) => withClient(fn),
}));
vi.mock('@/lib/security/audit', () => ({
  logAction: (...args: unknown[]) => logAction(...args),
}));
vi.mock('@/modules/mis-email/services/org-settings-lib', () => ({
  assertOrgOutboundMailEnabled: (...args: unknown[]) => assertOrgOutboundMailEnabled(...args),
  getMisEmailOrgSettings: (...args: unknown[]) => getMisEmailOrgSettings(...args),
}));
vi.mock('@/modules/mis-email/server/sync/major-repair-repeat-recipients', () => ({
  listEnabledEmailsForBranch: (...args: unknown[]) => listEnabledEmailsForBranch(...args),
  resolveAlertRecipients: () => ({ to: ['to@example.com'], cc: [] }),
}));
vi.mock('@/lib/mail/smtp', () => ({
  isSmtpConfigured: (...args: unknown[]) => isSmtpConfigured(...args),
  resolveSmtpConfig: (...args: unknown[]) => resolveSmtpConfig(...args),
  createMailTransport: (...args: unknown[]) => createMailTransport(...args),
}));

import type { HotRow } from '@/lib/read-model/types';

function hotRow(overrides: Partial<HotRow> = {}): HotRow {
  return {
    ncode: 1,
    vtrnno: '26F01029',
    vcclid: null,
    nofficeid: 1,
    nengineer: null,
    office_under: null,
    franchisee_code: null,
    party_name: 'Test',
    branch_name: 'PUNE',
    franchisee_name: null,
    pincode: null,
    city: null,
    state: null,
    region: 'WEST ZONE',
    account: 'Pepsi',
    item_name: null,
    serial: 'ABC123',
    wco: null,
    engineer_name: null,
    call_type: 'BREAKDOWN',
    complaint: null,
    status_label: 'Assigned',
    status_bucket: 'assigned',
    solve_remarks: null,
    contact_person: null,
    phone: null,
    address: null,
    has_visit: false,
    is_major: true,
    is_part_pending: false,
    branch_headcount: 0,
    logged_at: new Date('2026-06-01'),
    solved_at: null,
    edited_at: new Date('2026-06-26'),
    added_at: new Date('2026-06-01'),
    source_editedon: new Date('2026-06-26'),
    bsolved: false,
    bfastclose: false,
    bapproval: null,
    bm_approved_at: null,
    arcp_bm_approved_at: null,
    ncancelreason: 0,
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe('checkMajorRepairRepeatAlerts priority refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MAJOR_REPAIR_REPEAT_ALERT_ENABLED = 'true';
    process.env.MAJOR_REPAIR_REPEAT_MIN_COUNT = '3';
    process.env.MAJOR_REPAIR_REPEAT_MONTHS = '3';
    assertOrgOutboundMailEnabled.mockResolvedValue(undefined);
    getMisEmailOrgSettings.mockResolvedValue({
      majorRepairMinCount: 3,
      majorRepairMonths: 3,
      majorRepairDefaultTo: 'hq@example.com',
      majorRepairDefaultCc: '',
    });
    listEnabledEmailsForBranch.mockResolvedValue([{ email: 'bm@example.com', name: 'BM' }]);
    isSmtpConfigured.mockReturnValue(true);
    resolveSmtpConfig.mockReturnValue({ from: 'noreply@example.com' });
    createMailTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ messageId: 'mid-1' });
    priorityRefreshHotFromCrm.mockResolvedValue({ kind: 'ok', rowsUpserted: 2, rowsFetched: 2 });
    withClient.mockImplementation(async (fn: (client: { query: ReturnType<typeof vi.fn> }) => unknown) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      return fn(client);
    });

    // postQuery: repair flags, count, details (order of calls in happy path)
    postQuery
      .mockResolvedValueOnce({
        data: [{ id: 1, office_id: 1, has_motor: 1, has_compressor: 0, has_gas: 0 }],
      })
      .mockResolvedValueOnce({ data: [{ call_count: 3 }] })
      .mockResolvedValueOnce({
        data: [
          { vtrnno: '26F01029', callsdtrndate: '2026-06-01', PartyName: 'A', repair_done: 'Motor Replaced', vcomplaint: 'x', callstatus: 'Open' },
          { vtrnno: '26F01030', callsdtrndate: '2026-05-01', PartyName: 'B', repair_done: 'Motor Replaced', vcomplaint: 'y', callstatus: 'Closed' },
        ],
      });
  });

  it('priority-refreshes trigger + detail TRNs after a successful send', async () => {
    const { checkMajorRepairRepeatAlerts } = await import('./major-repair-repeat-alert');
    await checkMajorRepairRepeatAlerts([hotRow({ vtrnno: '26F01029', serial: 'ABC123' })]);

    expect(sendMail).toHaveBeenCalled();
    expect(priorityRefreshHotFromCrm).toHaveBeenCalledWith(['26F01029', '26F01030']);
  });

  it('still records sent and does not fail the alert if priority refresh throws', async () => {
    priorityRefreshHotFromCrm.mockRejectedValue(new Error('crm down'));
    const { checkMajorRepairRepeatAlerts } = await import('./major-repair-repeat-alert');
    await expect(
      checkMajorRepairRepeatAlerts([hotRow({ vtrnno: '26F01029', serial: 'ABC123' })])
    ).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalled();
    expect(priorityRefreshHotFromCrm).toHaveBeenCalled();
  });
});
