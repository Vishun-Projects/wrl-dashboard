import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { canSeeAllCallRegisterClients } from '@/features/report/lib/call-register/clients';
import {
  listVisibleCallRegisterClients,
  replaceVisibleCallRegisterClients,
} from '@/lib/call-register/visible-clients';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'deployment_completion',
    });
    if (!auth.ok) return auth.response;

    const clients = await listVisibleCallRegisterClients();
    return NextResponse.json({ clients });
  } catch (err) {
    console.error('[call-register/visible-clients GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'deployment_completion',
    });
    if (!auth.ok) return auth.response;

    const userAuth = await queryUserAuth(auth.userId);
    const email = userAuth?.profile?.email;
    if (!canSeeAllCallRegisterClients(email)) {
      return NextResponse.json({ error: 'Not allowed to edit visible accounts.' }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as { clients?: unknown } | null;
    const raw = Array.isArray(body?.clients) ? body.clients : null;
    if (!raw) {
      return NextResponse.json({ error: 'clients array is required.' }, { status: 400 });
    }
    const names = raw.map((c) => String(c ?? ''));

    try {
      const clients = await replaceVisibleCallRegisterClients(names);
      return NextResponse.json({ clients });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      if (message.includes('Select at least one')) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    console.error('[call-register/visible-clients PUT]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
