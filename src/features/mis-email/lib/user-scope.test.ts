import { describe, expect, it, vi } from 'vitest';
import { resolveUserDigestScopeWithLabel } from '@/features/mis-email/lib/user-scope';
import type { DigestRecipient } from '@/features/mis-email/lib/recipients';

vi.mock('@/lib/read-model/db', () => ({
  withAppClient: async (fn: (client: { query: (sql: string, args: unknown[]) => Promise<{ rows: Array<{ ncode: number; vcompanyname: string }> }> }) => Promise<unknown>) =>
    fn({
      query: async () => ({
        rows: [
          { ncode: 1, vcompanyname: 'Delhi Branch' },
          { ncode: 2, vcompanyname: 'Jaipur Branch' },
          { ncode: 3, vcompanyname: 'Hubli Branch' },
          { ncode: 4, vcompanyname: 'Kolkata Branch' },
        ],
      }),
    }),
}));

function recipient(overrides?: Partial<DigestRecipient>): DigestRecipient {
  return {
    id: 'u1',
    name: 'User',
    email: 'u@example.com',
    role: 'branch_manager',
    office_ids: ['1', '2', '3', '4'],
    visible_statuses: [],
    permissions: ['tab_mis_summary'],
    includeSummary: true,
    includeDetailed: false,
    includeKeyAccount: false,
    mis_email_enabled: true,
    mis_email_preferences: {},
    ...overrides,
  };
}

describe('resolveUserDigestScopeWithLabel', () => {
  it('compacts long branch lists in scope label', async () => {
    const result = await resolveUserDigestScopeWithLabel(recipient());
    expect(result.scopeLabel).toContain('Branches: Delhi Branch, Jaipur Branch, Hubli Branch +1 more');
  });

  it('keeps all-branches label for users with view_all_offices', async () => {
    const result = await resolveUserDigestScopeWithLabel(
      recipient({ permissions: ['view_all_offices', 'tab_mis_summary'] })
    );
    expect(result.scopeLabel).toBe('All branches');
  });
});
