import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { hasMisEmailSendAccess } from '@/lib/auth/rbac-catalog';
import { loadDigestRecipientById } from '@/features/mis-email/lib/recipients';
import { sendMisEmailComposeBatch } from '@/features/mis-email/lib/compose-digest';
import {
  createMisEmailSendJob,
  updateMisEmailSendJob,
} from '@/features/mis-email/lib/send-jobs';
import {
  mergeMisEmailPreferences,
  validateMisEmailPreferencesPatch,
  type MisEmailPreferences,
} from '@/features/mis-email/lib/preferences';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

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
    const body = (await request.json()) as {
      preferences?: MisEmailPreferences;
      sendTo?: string[];
      sendCc?: string[];
      savePreferences?: boolean;
      allowAutoSendDisabledOverride?: boolean;
    };

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

    const job = await createMisEmailSendJob(user.id);
    const jobStarted = Date.now();

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
          allowAutoSendDisabledOverride: body.allowAutoSendDisabledOverride === true,
          displayName: recipient.name,
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
      } catch (sendErr: unknown) {
        console.error(`[mis-email/send] job ${job.id}`, sendErr);
        await updateMisEmailSendJob(job.id, {
          status: 'failed',
          message: toUserFacingError(sendErr) || 'Failed to send MIS email',
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
          durationMs: Date.now() - jobStarted,
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
    return NextResponse.json(
      { error: toUserFacingError(err) || 'Failed to queue MIS email send' },
      { status: 500 }
    );
  }
}
