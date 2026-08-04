import { describe, expect, it } from 'vitest';
import {
  canManageMisEmailRouting,
  listMatchingMisEmailRoutingRulesForResolvedClients,
  normalizeMisEmailRoutingClientSourceMode,
  parseCommaEmails,
  pickBestMisEmailRoutingRule,
  resolveRoutingScheduleSlotStart,
  shouldTriggerRoutingRuleNow,
  type MisEmailRoutingRule,
} from '@/modules/mis-email/services/routing-rules';

function rule(
  id: string,
  values: Partial<
    Pick<
      MisEmailRoutingRule,
      'zone' | 'branch' | 'client' | 'clientSourceMode' | 'autoSendEnabled'
    >
  >
): MisEmailRoutingRule {
  return {
    id,
    zone: values.zone ?? '',
    branch: values.branch ?? '',
    client: values.client ?? '',
    clientSourceMode: values.clientSourceMode ?? 'mail',
    toEmails: ['to@example.com'],
    ccEmails: ['cc@example.com'],
    autoSendEnabled: values.autoSendEnabled ?? true,
    scheduleAnchorTimeIst: '07:00',
    scheduleIntervalMinutes: 1440,
    scheduleDaysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    scheduleWindowStartIst: null,
    scheduleWindowEndIst: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

describe('parseCommaEmails', () => {
  it('normalizes and dedupes comma-separated emails', () => {
    expect(parseCommaEmails('A@Example.com, b@example.com, a@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('throws on invalid email token', () => {
    expect(() => parseCommaEmails('ok@example.com,not-an-email')).toThrow(/Invalid email/);
  });
});

describe('pickBestMisEmailRoutingRule', () => {
  it('prefers exact zone+branch+client over broader matches', () => {
    const selected = pickBestMisEmailRoutingRule({
      rules: [
        rule('1', { zone: 'NORTH', branch: 'DELHI BRANCH' }),
        rule('2', { zone: 'NORTH', client: 'COKE' }),
        rule('3', { zone: 'NORTH', branch: 'DELHI BRANCH', client: 'COKE' }),
      ],
      zones: ['NORTH ZONE'],
      branches: ['Delhi Branch'],
      client: 'coke',
    });
    expect(selected?.id).toBe('3');
  });

  it('returns null when no rule matches', () => {
    const selected = pickBestMisEmailRoutingRule({
      rules: [rule('1', { zone: 'SOUTH' })],
      zones: ['NORTH'],
      branches: ['Delhi Branch'],
      client: 'coke',
    });
    expect(selected).toBeNull();
  });

  it('supports comma-separated multi-select dimensions', () => {
    const selected = pickBestMisEmailRoutingRule({
      rules: [rule('1', { zone: 'NORTH, EAST', branch: 'DELHI BRANCH, PATNA BRANCH', client: 'COKE, PEPSI' })],
      zones: ['east zone'],
      branches: ['patna branch'],
      client: 'pepsi',
    });
    expect(selected?.id).toBe('1');
  });

  it('prefers narrower rules over broad multi-select rules', () => {
    const selected = pickBestMisEmailRoutingRule({
      rules: [
        rule('broad', { zone: 'NORTH', branch: 'DELHI BRANCH', client: 'COKE,PEPSI' }),
        rule('narrow', { zone: 'NORTH', branch: 'DELHI BRANCH', client: 'COKE' }),
      ],
      zones: ['NORTH'],
      branches: ['DELHI BRANCH'],
      client: 'coke',
    });
    expect(selected?.id).toBe('narrow');
  });
});

describe('client source mode helpers', () => {
  it('defaults invalid source modes to mail', () => {
    expect(normalizeMisEmailRoutingClientSourceMode(undefined)).toBe('mail');
    expect(normalizeMisEmailRoutingClientSourceMode('weird')).toBe('mail');
    expect(normalizeMisEmailRoutingClientSourceMode('crm')).toBe('crm');
  });

  it('matches rules against the saved client source mode', () => {
    const matching = listMatchingMisEmailRoutingRulesForResolvedClients({
      rules: [
        rule('mail-rule', { zone: 'NORTH', client: 'COKE', clientSourceMode: 'mail' }),
        rule('crm-rule', { zone: 'NORTH', client: 'COKE', clientSourceMode: 'crm' }),
      ],
      zones: ['NORTH'],
      branches: ['Delhi Branch'],
      mailClients: ['COKE'],
      crmClients: ['PEPSI'],
    });
    expect(matching.map((item) => item.id)).toEqual(['mail-rule']);
  });

  it('can match a crm-only rule when the crm client set contains it', () => {
    const matching = listMatchingMisEmailRoutingRulesForResolvedClients({
      rules: [rule('crm-rule', { zone: 'NORTH', client: 'PEPSI', clientSourceMode: 'crm' })],
      zones: ['NORTH'],
      branches: ['Delhi Branch'],
      mailClients: ['COKE'],
      crmClients: ['PEPSI'],
    });
    expect(matching.map((item) => item.id)).toEqual(['crm-rule']);
  });
});

describe('canManageMisEmailRouting', () => {
  it('allows view_all_offices users', () => {
    expect(
      canManageMisEmailRouting({
        role: 'branch_manager',
        office_ids: ['1'],
        permissions: ['view_all_offices'],
      })
    ).toBe(true);
  });
});

describe('shouldTriggerRoutingRuleNow', () => {
  it('triggers when now falls inside schedule window', () => {
    const scheduled = shouldTriggerRoutingRuleNow(
      {
        ...rule('r1', {}),
        scheduleAnchorTimeIst: '07:00',
        scheduleIntervalMinutes: 60,
        scheduleDaysOfWeek: ['WED'],
      },
      { now: new Date('2026-07-08T01:35:00.000Z'), windowMinutes: 15 }
    );
    expect(scheduled).toBe(true);
  });

  it('uses personal sendTimeIst override instead of rule anchor', () => {
    const atPersonal = shouldTriggerRoutingRuleNow(
      {
        ...rule('r1', {}),
        scheduleAnchorTimeIst: '07:00',
        scheduleIntervalMinutes: 1440,
        scheduleDaysOfWeek: ['WED'],
      },
      {
        now: new Date('2026-07-08T04:00:00.000Z'), // 09:30 IST
        windowMinutes: 15,
        sendTimeIst: '09:30',
      }
    );
    expect(atPersonal).toBe(true);

    const atRuleOnly = shouldTriggerRoutingRuleNow(
      {
        ...rule('r1', {}),
        scheduleAnchorTimeIst: '07:00',
        scheduleIntervalMinutes: 1440,
        scheduleDaysOfWeek: ['WED'],
      },
      {
        now: new Date('2026-07-08T04:00:00.000Z'), // 09:30 IST
        windowMinutes: 15,
      }
    );
    expect(atRuleOnly).toBe(false);
  });

  it('does not re-fire at 09:45 after a 09:30 daily anchor', () => {
    expect(
      shouldTriggerRoutingRuleNow(
        {
          ...rule('r1', {}),
          scheduleAnchorTimeIst: '07:00',
          scheduleIntervalMinutes: 1440,
          scheduleDaysOfWeek: ['WED'],
        },
        {
          now: new Date('2026-07-08T04:15:00.000Z'), // 09:45 IST
          windowMinutes: 15,
          sendTimeIst: '09:30',
        }
      )
    ).toBe(false);
  });
});

describe('resolveRoutingScheduleSlotStart', () => {
  it('anchors the daily slot at personal send time in IST', () => {
    const slot = resolveRoutingScheduleSlotStart(
      {
        scheduleAnchorTimeIst: '07:00',
        scheduleIntervalMinutes: 1440,
      },
      {
        now: new Date('2026-07-08T04:15:00.000Z'), // 09:45 IST
        sendTimeIst: '09:30',
      }
    );
    expect(slot.toISOString()).toBe('2026-07-08T04:00:00.000Z'); // 09:30 IST
  });
});
