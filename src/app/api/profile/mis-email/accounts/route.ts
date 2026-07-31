import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadDigestRecipientById } from '@/features/mis-email/services/recipients';
import {
  resolveDigestDateRangeForPreferences,
  type MisEmailDateRangeMode,
} from '@/features/mis-email/services/preferences';
import { jsonSafeError } from '@/lib/api/safe-error';
import {
  queryDigestAccountNamesByZone,
} from '@/features/mis-email/services/query-digest-account-names';
import { resolveUserDigestScopeWithLabel } from '@/features/mis-email/services/user-scope';

/** Fast key-account name list for the email composer (no full MIS aggregation). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const dateRangeParam = searchParams.get('dateRange');
    const dateRangeMode: MisEmailDateRangeMode =
      dateRangeParam === 'yesterday' ||
      dateRangeParam === 'month_to_date' ||
      dateRangeParam === 'year_to_yesterday'
        ? dateRangeParam
        : 'month_to_date';

    const recipient = await loadDigestRecipientById(user.id);
    if (!recipient?.includeKeyAccount) {
      return NextResponse.json({
        availableKeyAccounts: [],
        accountsByZone: { NORTH: [], EAST: [], WEST: [], SOUTH: [] },
      });
    }

    const scope = await resolveUserDigestScopeWithLabel(recipient);
    const dateRange = resolveDigestDateRangeForPreferences({ dateRange: dateRangeMode });
    const accountsByZone = await queryDigestAccountNamesByZone(scope, dateRange);
    const seen = new Set<string>();
    const availableKeyAccounts: string[] = [];
    for (const zone of ['NORTH', 'EAST', 'WEST', 'SOUTH'] as const) {
      for (const name of accountsByZone[zone] ?? []) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        availableKeyAccounts.push(name);
      }
    }
    availableKeyAccounts.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ availableKeyAccounts, accountsByZone });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load key accounts');
  }
}
