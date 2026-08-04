import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { hasMisEmailSendAccess } from '@/lib/auth/rbac-catalog';
import { loadDigestRecipientById } from '@/modules/mis-email/services/recipients';
import { sendMisEmailComposeBatch } from '@/modules/mis-email/services/compose-digest';
import { parseMisEmailIntroPreset } from '@/modules/mis-email/services/email-template';
import {
  createMisEmailSendJob,
  updateMisEmailSendJob,
} from '@/modules/mis-email/services/send-jobs';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { safeErrorMessage } from '@/lib/api/safe-error';
import {
  mergeMisEmailPreferences,
  validateMisEmailPreferencesPatch,
  type MisEmailPreferences,
} from '@/modules/mis-email/services/preferences';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { logAccessDenied, logAction } from '@/lib/security/audit';

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
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'profile_mis_email_send_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await queryUserAuth(user.id);
  const actor = {
    userId: user.id,
    email: auth?.profile?.email ?? user.email ?? null,
    name: auth?.profile?.name ?? null,
  };

  try {
    const body = (await request.json()) as {
      preferences?: MisEmailPreferences;
      sendTo?: string[];
      sendCc?: string[];
      savePreferences?: boolean;
      introPreset?: unknown;
    };

    const introPreset =
      body.introPreset === undefined ? undefined : parseMisEmailIntroPreset(body.introPreset);
    if (body.introPreset !== undefined && introPreset === null) {
      return NextResponse.json(
        { error: 'introPreset must be "normal" or "revised"' },
        { status: 400 }
      );
    }

    const [row, recipient] = await Promise.all([
      loadMisEmailRow(user.id),
      loadDigestRecipientById(user.id),
    ]);

    if (!row || !recipient) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (!hasMisEmailSendAccess(recipient.permissions)) {
      return NextResponse.json(
        { error: 'Your role is missing the “MIS email reports” capability (Mail access).' },
        { status: 403 }
      );
    }

    if (!recipient.includeSummary && !recipient.includeDetailed && !recipient.includeKeyAccount) {
      return NextResponse.json(
        {
          error:
            'Mail access alone is not enough — also assign a role with MIS Summary, Call Register, or Key Account (or full MIS Reports).',
        },
        { status: 403 }
      );
    }

    const current = mergeMisEmailPreferences(row.mis_email_preferences);
    const permissions = {
      includeSummary: recipient.includeSummary,
      includeDetailed: recipient.includeDetailed,
      includeKeyAccount: recipient.includeKeyAccount,
    };

    const { getMisEmailOrgSettings } = await import('@/modules/mis-email/services/org-settings');
    const org = await getMisEmailOrgSettings();
    const validated = validateMisEmailPreferencesPatch({
      patch: body.preferences ?? {},
      permissions,
      current,
      misEmailEnabled: true,
      allowedEmailDomains: org.allowedEmailDomains,
    });

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    // Also validate explicit sendTo/sendCc when provided
    try {
      const { assertAllowedEmailDomains } = await import(
        '@/modules/mis-email/services/allowed-domains'
      );
      assertAllowedEmailDomains(
        [...(body.sendTo ?? []), ...(body.sendCc ?? [])],
        org.allowedEmailDomains
      );
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Invalid recipient domain') },
        { status: 400 }
      );
    }

    if (body.savePreferences) {
      await prisma.$queryRawUnsafe(
        `UPDATE public.app_users SET mis_email_preferences = $1::jsonb WHERE id = $2`,
        JSON.stringify(validated.merged),
        user.id
      );
    }

    const job = await createMisEmailSendJob(user.id);
    const jobStarted = Date.now();

    await logAction({
      request,
      action: 'profile.mis_email.send',
      actor,
      result: 'started',
      statusCode: 202,
      target: { type: 'mis_email_send_job', id: job.id },
      summary: 'Queued MIS email digest send',
      metadata: {
        dateRange: validated.merged.dateRange ?? null,
        toCount: (body.sendTo ?? []).length,
        ccCount: (body.sendCc ?? []).length,
      },
    });

    after(async () => {
      await updateMisEmailSendJob(job.id, {
        status: 'running',
        message: 'Building reports and sending email…',
      });

      try {
        const results = await sendMisEmailComposeBatch(recipient, {
          preferences: validated.merged,
          sendTo: body.sendTo,
          sendCc: body.sendCc,
          displayName: recipient.name,
          introPreset: introPreset ?? undefined,
        });

        const durationMs = Date.now() - jobStarted;
        const timing = results[0]?.timing;
        const sent = results.map(({ timing: _timing, ...rest }) => {
          void _timing;
          return rest;
        });
        const summary = sent.map((item) => item.sentTo).join(', ');

        console.log(
          `[mis-email/send] job ${job.id} completed in ${durationMs}ms · recipients=${results.length} · dateRange=${validated.merged.dateRange ?? 'month_to_date'}`
        );

        await updateMisEmailSendJob(job.id, {
          status: 'succeeded',
          message: `Sent to ${summary}`,
          sent,
          durationMs,
          timing,
        });

        await logAction({
          request,
          action: 'profile.mis_email.send',
          actor,
          result: 'completed',
          statusCode: 200,
          target: { type: 'mis_email_send_job', id: job.id },
          summary: `Sent MIS email digest to ${summary}`,
          metadata: { durationMs, recipientCount: results.length },
        });
      } catch (sendErr: unknown) {
        console.error(`[mis-email/send] job ${job.id}`, sendErr);
        await updateMisEmailSendJob(job.id, {
          status: 'failed',
          message: toUserFacingError(sendErr) || 'Failed to send MIS email',
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
          durationMs: Date.now() - jobStarted,
        });
        await logAction({
          request,
          action: 'profile.mis_email.send',
          actor,
          result: 'failure',
          statusCode: 500,
          target: { type: 'mis_email_send_job', id: job.id },
          summary: 'MIS email digest send failed',
          metadata: { message: toUserFacingError(sendErr) },
        });
      }
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
        status: job.status,
        message: job.message,
        savedPreferences: Boolean(body.savePreferences),
      },
      { status: 202 }
    );
  } catch (err: unknown) {
    console.error('[mis-email/send]', err);
    await logAction({
      request,
      action: 'profile.mis_email.send',
      actor,
      result: 'failure',
      statusCode: 500,
      summary: 'Failed to queue MIS email send',
      metadata: { message: toUserFacingError(err) },
    });
    return NextResponse.json(
      { error: toUserFacingError(err) || 'Failed to queue MIS email send' },
      { status: 500 }
    );
  }
}
