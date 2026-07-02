import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadDigestRecipientById } from '@/lib/mis-email/recipients';
import { sendMisEmailViaVpsRelay, isMisEmailRelayConfigured } from '@/lib/mis-email/send-relay';
import { isVpsSshSendConfigured, sendMisEmailViaVpsSsh } from '@/lib/mis-email/send-vps-ssh';
import {
  mergeMisEmailPreferences,
  validateMisEmailPreferencesPatch,
  type MisEmailPreferences,
} from '@/lib/mis-email/preferences';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

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

  const started = Date.now();

  try {
    const body = (await request.json()) as {
      preferences?: MisEmailPreferences;
      sendTo?: string[];
      savePreferences?: boolean;
    };

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
    });

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    if (body.savePreferences) {
      await prisma.$queryRawUnsafe(
        `UPDATE public.app_users SET mis_email_preferences = $1::jsonb WHERE id = $2`,
        JSON.stringify(validated.merged),
        user.id
      );
    }

    let results;
    try {
      if (!isMisEmailRelayConfigured()) {
        throw new Error('VPS_MAIL_RELAY_SECRET is not set');
      }
      results = await sendMisEmailViaVpsRelay({
        userId: user.id,
        preferences: validated.merged,
        sendTo: body.sendTo,
      });
    } catch (relayErr) {
      if (process.env.NODE_ENV === 'development' && isVpsSshSendConfigured()) {
        console.warn('[mis-email/send] HTTPS relay failed, using VPS SSH fallback:', relayErr);
        results = await sendMisEmailViaVpsSsh({
          userId: user.id,
          preferences: validated.merged,
          sendTo: body.sendTo,
        });
      } else {
        throw relayErr;
      }
    }

    return NextResponse.json({
      ok: true,
      sent: results,
      savedPreferences: Boolean(body.savePreferences),
      durationMs: Date.now() - started,
    });
  } catch (err: unknown) {
    console.error('[mis-email/send]', err);
    return NextResponse.json(
      { error: toUserFacingError(err) || 'Failed to send MIS email' },
      { status: 500 }
    );
  }
}
