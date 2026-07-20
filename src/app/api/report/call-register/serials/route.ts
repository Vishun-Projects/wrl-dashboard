import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { resolveCallRegisterDates } from '@/lib/report/call-register/dates';
import { isCallRegisterClient } from '@/lib/report/call-register/sql';
import { fetchCallRegisterSerialExportRows } from '@/lib/report/call-register/serial-export';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'deployment_completion',
    });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const client = (searchParams.get('client') || '').trim();
    if (!isCallRegisterClient(client)) {
      return NextResponse.json({ error: 'Select a valid client.' }, { status: 400 });
    }

    const { dateFrom, dateTo } = resolveCallRegisterDates(searchParams);
    const rows = await fetchCallRegisterSerialExportRows(client, { dateFrom, dateTo });

    const deployed = rows.filter((r) => r.pendingDeploy === 'No').length;
    const installed = rows.filter((r) => r.pendingInstall === 'No').length;

    return NextResponse.json({
      client,
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
