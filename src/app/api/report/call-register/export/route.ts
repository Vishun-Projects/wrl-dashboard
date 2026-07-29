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
import { logAction } from '@/lib/security/audit';

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
    const actor = {
      userId: auth.userId,
      email: email ?? null,
      name: userAuth?.profile?.name ?? null,
    };

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
    await logAction({
      request: req,
      action: 'report.export.complete',
      actor,
      result: 'completed',
      statusCode: 200,
      target: { type: 'call_register_export', label: filename },
      summary: `Exported Call Register (${rows.length} rows)`,
      metadata: { clientCount: validated.clients.length, rowCount: rows.length, ...params },
    });

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
    await logAction({
      request: req,
      action: 'report.export.failure',
      actor: { userId: null, email: null, name: null },
      result: 'failure',
      statusCode: 500,
      target: { type: 'call_register_export' },
      summary: 'Call Register export failed',
      metadata: { message: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
