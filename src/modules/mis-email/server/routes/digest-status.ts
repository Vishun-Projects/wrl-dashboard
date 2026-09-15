import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { logAccessDenied } from '@/lib/security/audit';
import { jsonSafeError } from '@/lib/api/safe-error';
import { isSubcontractorVpsHost } from '@/lib/mail/subcontractor-relay-client';
import {
  relayPostJson,
  resolveVpsMailRelaySecret,
} from '@/lib/mail/relay-client';
import {
  readMisEmailDigestRunStatus,
  type MisEmailDigestRunStatus,
} from '@/modules/mis-email/services/digest-run-status';

const RELAY_PATH = '/internal/mail/mis-digest-status';

function publicStatus(status: MisEmailDigestRunStatus) {
  return {
    running: status.running,
    phase: status.phase,
    asOf: status.asOf,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    lastFinishedAt: status.lastFinishedAt,
    lastOutcome: status.lastOutcome,
    lastSkipReason: status.lastSkipReason,
    lastSentCount: status.lastSentCount,
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'mis_email_digest_status_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const auth = await loadUserAuth(user.id);
  if (!auth?.permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: auth?.profile?.email ?? user.email ?? null,
      statusCode: 403,
      reason: 'mis_email_digest_status_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    if (isSubcontractorVpsHost()) {
      return NextResponse.json(publicStatus(readMisEmailDigestRunStatus()));
    }

    const secret = resolveVpsMailRelaySecret();
    if (!secret) {
      return NextResponse.json({
        running: false,
        phase: 'unavailable',
        asOf: null,
        startedAt: null,
        updatedAt: null,
        lastFinishedAt: null,
        lastOutcome: null,
        lastSkipReason: 'VPS mail relay not configured',
        lastSentCount: null,
      });
    }

    const relay = await relayPostJson<MisEmailDigestRunStatus & { ok?: boolean; error?: string }>(
      RELAY_PATH,
      {},
      secret
    );
    if (relay.data.error) {
      return NextResponse.json(
        {
          running: false,
          phase: 'unavailable',
          asOf: null,
          startedAt: null,
          updatedAt: null,
          lastFinishedAt: null,
          lastOutcome: null,
          lastSkipReason: relay.data.error,
          lastSentCount: null,
        },
        { status: 200 }
      );
    }
    return NextResponse.json(publicStatus(relay.data));
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load MIS digest status');
  }
}
