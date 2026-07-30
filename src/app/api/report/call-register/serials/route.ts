import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { resolveCallRegisterDates } from '@/features/report/lib/call-register/dates';
import { validateCallRegisterExportClients } from '@/features/report/lib/call-register/clients';
import { listVisibleCallRegisterClients } from '@/lib/call-register/visible-clients';
import { fetchCallRegisterSerialExportRows } from '@/features/report/lib/call-register/serial-export';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'deployment_completion',
    });
    if (!auth.ok) return auth.response;

    const userAuth = await queryUserAuth(auth.userId);

    const { searchParams } = new URL(req.url);
    const client = (searchParams.get('client') || '').trim();
    const allowedClients = await listVisibleCallRegisterClients();
    const validated = validateCallRegisterExportClients(
      client ? [client] : [],
      userAuth?.permissions,
      allowedClients
    );
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { dateFrom, dateTo, dateField } = resolveCallRegisterDates(searchParams);
    const rows = await fetchCallRegisterSerialExportRows(validated.clients, {
      dateFrom,
      dateTo,
      dateField,
    });

    const deployed = rows.filter((r) => r.pendingDeploy === 'No').length;
    const installed = rows.filter((r) => r.pendingInstall === 'No').length;

    return NextResponse.json({
      client: validated.clients[0],
      rows,
      summary: {
        billingCount: rows.length,
        deployed,
        installed,
        pendingDeploy: rows.length - deployed,
        pendingInstall: rows.length - installed,
      },
    });
  } catch (err) {
    console.error('[call-register/serials]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
