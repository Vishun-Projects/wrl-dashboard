import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isSuperAdmin } from '@/lib/auth/rbac-catalog';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logAction } from '@/lib/security/audit';
import { isSubcontractorVpsHost } from '@/lib/mail/subcontractor-relay-client';
import { startCallsHotSyncThroughYesterday } from '@/lib/read-model/start-calls-hot-sync';
import { runFastCallsHotSyncThroughYesterday } from '@/lib/read-model/manual-calls-hot-sync';
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
    const body = (await request.json().catch(() => ({}))) as {
      asOf?: string;
      mode?: 'fast' | 'thorough';
    };
    const asOf = typeof body.asOf === 'string' ? body.asOf.trim() : undefined;
    const fast = body.mode === 'fast';

    if (!fast && isSubcontractorVpsHost()) {
      const result = startCallsHotSyncThroughYesterday({ asOf });
      await logAction({
        request,
        action: 'sync.manual.calls_hot',
        actor,
        result: 'success',
        summary: result.detail,
        metadata: { asOf: result.asOf, pid: result.pid, started: result.started, mode: 'thorough' },
      });
      return NextResponse.json({ success: true, ...result });
    }

    if (!fast) {
      const secret = resolveVpsMailRelaySecret();
      if (!secret) {
        return NextResponse.json(
          { error: 'VPS mail relay not configured — cannot start YTD calls sync from this host' },
          { status: 503 }
        );
      }
      const relay = await relayPostJson<{
        ok?: boolean;
        started?: boolean;
        asOf?: string;
        pid?: number;
        detail?: string;
        error?: string;
      }>(RELAY_PATH, { asOf, mode: 'thorough' }, secret);
      if (relay.data.error) {
        return NextResponse.json({ error: relay.data.error }, { status: 502 });
      }
      await logAction({
        request,
        action: 'sync.manual.calls_hot',
        actor,
        result: 'success',
        summary: String(relay.data.detail ?? 'YTD calls sync started'),
        metadata: { asOf: relay.data.asOf, pid: relay.data.pid, mode: 'thorough' },
      });
      return NextResponse.json({ success: true, ...relay.data });
    }

    let result: Awaited<ReturnType<typeof runFastCallsHotSyncThroughYesterday>>;
    if (isSubcontractorVpsHost()) {
      result = await runFastCallsHotSyncThroughYesterday(asOf);
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
        asOf?: string;
        rowsUpserted?: number;
        detail?: string;
        error?: string;
      }>(RELAY_PATH, { asOf }, secret);
      if (relay.data.error) {
        return NextResponse.json({ error: relay.data.error }, { status: 502 });
      }
      result = {
        ok: Boolean(relay.data.ok),
        asOf: String(relay.data.asOf ?? asOf ?? ''),
        rowsUpserted: Number(relay.data.rowsUpserted ?? 0),
        rowsDeleted: 0,
        crmRowsFetched: 0,
        catchupUpserted: 0,
        pipelineRefreshed: 0,
        techSolvedUpserted: 0,
        detail: String(relay.data.detail ?? 'relay sync complete'),
      };
    }

    if (!result.ok) {
      await logAction({
        request,
        action: 'sync.manual.calls_hot',
        actor,
        result: 'failure',
        summary: result.detail,
        metadata: { asOf: result.asOf, rowsUpserted: result.rowsUpserted },
      });
      return NextResponse.json({ error: result.detail, ...result }, { status: 502 });
    }

    await logAction({
      request,
      action: 'sync.manual.calls_hot',
      actor,
      result: 'success',
      summary: result.detail,
      metadata: { asOf: result.asOf, rowsUpserted: result.rowsUpserted, mode: 'fast' },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}