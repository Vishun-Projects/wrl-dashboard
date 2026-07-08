import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadDigestRecipientById } from '@/lib/mis-email/recipients';
import {
  resolveDigestDateRangeForPreferences,
  type MisEmailDateRangeMode,
} from '@/lib/mis-email/preferences';
import { queryDigestAccountNames } from '@/lib/mis-email/query-digest-account-names';
import { resolveUserDigestScopeWithLabel } from '@/lib/mis-email/user-scope';

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
      return NextResponse.json({ availableKeyAccounts: [] });
    }

    const scope = await resolveUserDigestScopeWithLabel(recipient);
    const dateRange = resolveDigestDateRangeForPreferences({ dateRange: dateRangeMode });
    const availableKeyAccounts = await queryDigestAccountNames(scope, dateRange);

    return NextResponse.json({ availableKeyAccounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load key accounts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
