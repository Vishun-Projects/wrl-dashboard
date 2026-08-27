import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAccessPage } from '@/lib/auth/rbac-catalog';
import {
  getMisEmailOrgSettings,
  saveMisEmailOrgSettings,
} from '@/modules/mis-email/services/org-settings';
import { normalizeMisEmailSendTime } from '@/modules/mis-email/services/preferences';
import { runCancelledCallDigest } from '@/modules/mis-email/services/cancelled-call-digest';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logAction } from '@/lib/security/audit';

async function requireAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({
      request,
      statusCode: 401,
      reason: 'cancelled_call_digest_unauthorized',
    });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const auth = await loadUserAuth(user.id);
  if (!auth) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 401,
      reason: 'cancelled_call_digest_unauthorized',
    });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!canAccessPage(auth.permissions, 'cancelled_call_alerts')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: auth.profile.email ?? null,
      statusCode: 403,
      reason: 'cancelled_call_digest_forbidden',
    });
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return {
    auth,
    user,
    actor: {
      userId: user.id,
      email: auth.profile.email ?? user.email ?? null,
      name: auth.profile.name ?? null,
    },
  };
}

export async function GET(request: Request) {
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const org = await getMisEmailOrgSettings();
    return NextResponse.json({
      sendTimeIst: org.cancelledCallDigestSendTimeIst,
      scheduleNote:
        'VPS cron polls every 15 min Mon–Sat IST; mail sends when the clock hits your send time (15 min window).',
    });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load schedule');
  }
}

export async function PUT(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const body = await request.json();
    const sendTimeIst = normalizeMisEmailSendTime(body.sendTimeIst);
    if (!sendTimeIst) {
      return NextResponse.json({ error: 'sendTimeIst must be HH:mm (24h IST)' }, { status: 400 });
    }
    const settings = await saveMisEmailOrgSettings(
      { cancelledCallDigestSendTimeIst: sendTimeIst },
      access.user.id
    );
    await logAction({
      request,
      actor: access.actor,
      action: 'admin.cancelled_call_digest.schedule.update',
      result: 'success',
      statusCode: 200,
      summary: `Cancelled-call digest send time → ${sendTimeIst} IST`,
      metadata: { sendTimeIst: settings.cancelledCallDigestSendTimeIst },
    });
    return NextResponse.json({ sendTimeIst: settings.cancelledCallDigestSendTimeIst });
  } catch (err: unknown) {
    return jsonSafeError(err, 400, 'Failed to save schedule');
  }
}

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const body = await request.json().catch(() => ({}));
    const digestDate =
      typeof body.digestDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.digestDate.trim())
        ? body.digestDate.trim()
        : undefined;
    const branch = typeof body.branch === 'string' ? body.branch.trim() : undefined;
    const dryRun = body.dryRun === true;

    const result = await runCancelledCallDigest({
      digestDate,
      force: true,
      branch,
      dryRun,
    });

    await logAction({
      request,
      actor: access.actor,
      action: 'admin.cancelled_call_digest.send_test',
      result: result.failed.length ? 'failure' : 'success',
      statusCode: result.failed.length ? 500 : 200,
      summary: dryRun
        ? `Dry-run cancelled-call digest for ${result.digestDate}`
        : `Test send cancelled-call digest for ${result.digestDate}`,
      metadata: {
        digestDate: result.digestDate,
        sent: result.sent.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
        branch: branch ?? null,
        dryRun,
      },
    });

    if (result.failed.length) {
      return NextResponse.json(
        {
          error: safeErrorMessage(result.failed[0]?.error, 'Send failed'),
          result,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Test send failed');
  }
}
