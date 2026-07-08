import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadDigestRecipientById } from '@/lib/mis-email/recipients';
import { previewMisEmailCompose } from '@/lib/mis-email/compose-digest';
import {
  mergeMisEmailPreferences,
  validateMisEmailPreferencesPatch,
  type MisEmailPreferences,
} from '@/lib/mis-email/preferences';

export const maxDuration = 300;

type MisEmailRow = {
  mis_email_enabled: boolean;
  mis_email_preferences: unknown;
};

async function loadMisEmailRow(userId: string): Promise<MisEmailRow | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT mis_email_enabled, mis_email_preferences FROM public.app_users WHERE id = $1 LIMIT 1`,
    userId
  )) as MisEmailRow[];
  return rows[0] ?? null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { preferences?: MisEmailPreferences };
    const [row, recipient] = await Promise.all([
      loadMisEmailRow(user.id),
      loadDigestRecipientById(user.id),
    ]);

    if (!row || !recipient) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    if (!row.mis_email_enabled) {
      return NextResponse.json({ error: 'MIS email is not enabled for your account' }, { status: 403 });
    }

    const current = mergeMisEmailPreferences(row.mis_email_preferences);
    const permissions = {
      includeSummary: recipient.includeSummary,
      includeDetailed: recipient.includeDetailed,
      includeKeyAccount: recipient.includeKeyAccount,
    };

    const validated = validateMisEmailPreferencesPatch({
      patch: body.preferences ?? {},
      permissions,
      current,
      misEmailEnabled: true,
      forPreview: true,
    });

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const preview = await previewMisEmailCompose(recipient, {
      preferences: validated.merged,
      displayName: recipient.name,
    });

    return NextResponse.json({ ok: true, preview });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to build email preview';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
