import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { fetchCallRegisterRows } from '@/features/report/services/call-register';
import { canSeeAllCallRegisterClients } from '@/lib/call-register/clients';
import { resolveCallRegisterDates } from '@/features/report/services/call-register/dates';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'deployment_completion',
    });
    if (!auth.ok) return auth.response;

    const userAuth = await queryUserAuth(auth.userId);
    const allClients = canSeeAllCallRegisterClients(userAuth?.permissions);

    const { searchParams } = new URL(req.url);
    const { dateFrom, dateTo, dateField } = resolveCallRegisterDates(searchParams);

    const { rows, summary, sharedClients, clientOptions } = await fetchCallRegisterRows({
      dateFrom,
      dateTo,
      dateField,
      allClients,
    });

    return NextResponse.json({
      rows,
      summary,
      allClients,
      sharedClients,
      clientOptions,
    });
  } catch (err) {
    console.error('[call-register]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
