import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { resolveCallRegisterDates } from '@/features/report/lib/call-register/dates';
import {
  parseCallRegisterClientList,
  validateCallRegisterExportClients,
} from '@/features/report/lib/call-register/clients';
import { listVisibleCallRegisterClients } from '@/lib/call-register/visible-clients';
import {
  callRegisterSerialExportFilename,
  fetchCallRegisterSerialExportRows,
} from '@/features/report/lib/call-register/serial-export';
import { buildCallRegisterSerialWorkbook } from '@/features/report/lib/call-register/excel-export';
import { workbookToBuffer } from '@/features/report/lib/summary-excel-export';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'deployment_completion',
    });
    if (!auth.ok) return auth.response;

    const userAuth = await queryUserAuth(auth.userId);
    const email = userAuth?.profile?.email;

    const { searchParams } = new URL(req.url);
    const clientsParam =
      searchParams.get('clients') || searchParams.get('client') || '';
    const parsed = parseCallRegisterClientList(clientsParam);
    const allowedClients = await listVisibleCallRegisterClients();
    const validated = validateCallRegisterExportClients(parsed, email, allowedClients);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { dateFrom, dateTo, dateField } = resolveCallRegisterDates(searchParams);
    const params = { dateFrom, dateTo, dateField };

    const rows = await fetchCallRegisterSerialExportRows(validated.clients, params);
    const workbook = await buildCallRegisterSerialWorkbook(rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = callRegisterSerialExportFilename(params);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[call-register/export]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
