import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isSuperAdmin } from '@/lib/auth/rbac-catalog';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logAction } from '@/lib/security/audit';
import { isSubcontractorVpsHost } from '@/modules/subcontractor-stock/services/vps-host';
import { startCallsHotSyncThroughYesterday } from '@/lib/read-model/start-calls-hot-sync';
import {
  relayPostJson,
  resolveVpsMailRelaySecret,
} from '@/lib/mail/relay-client';

const RELAY_PATH = '/internal/mail/sync/calls-hot';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const csrf = assertSameOriginMutation(request);
    if (csrf) return csrf;

    const supabase = await createClient();
    const user = await requireRequestUser(request, supabase);
    if (!user) {
      await logAccessDenied({ request, statusCode: 401, reason: 'calls_hot_sync_unauthorized' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const auth = await loadUserAuth(user.id);
    if (!auth || !isSuperAdmin(auth.permissions)) {
      await logAccessDenied({
        request,
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        statusCode: 403,
        reason: 'calls_hot_sync_forbidden',
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const actor = { userId: user.id, email: auth.profile.email ?? user.email ?? null };
    const body = (await request.json().catch(() => ({}))) as { asOf?: string };
    const asOf = typeof body.asOf === 'string' ? body.asOf.trim() : undefined;

    let result: ReturnType<typeof startCallsHotSyncThroughYesterday>;
    if (isSubcontractorVpsHost()) {
      result = startCallsHotSyncThroughYesterday({ asOf });
    } else {
      const secret = resolveVpsMailRelaySecret();
      if (!secret) {
        return NextResponse.json(
          { error: 'VPS mail relay not configured — cannot start calls sync from this host' },
          { status: 503 }
        );
      }
      const relay = await relayPostJson<{
        ok?: boolean;
        started?: boolean;
        asOf?: string;
        pid?: number | null;
        logPath?: string;
        detail?: string;
        error?: string;
      }>(RELAY_PATH, { asOf }, secret);
      if (relay.data.error) {
        return NextResponse.json({ error: relay.data.error }, { status: 502 });
      }
      result = {
        started: Boolean(relay.data.started),
        asOf: String(relay.data.asOf ?? asOf ?? ''),
        pid: relay.data.pid ?? null,
        logPath: String(relay.data.logPath ?? ''),
        detail: String(relay.data.detail ?? 'relay started'),
      };
    }

    await logAction({
      request,
      action: 'sync.manual.calls_hot',
      actor,
      result: 'success',
      summary: result.detail,
      metadata: { asOf: result.asOf, pid: result.pid, started: result.started },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
