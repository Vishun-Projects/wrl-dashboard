import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { resolveCallRegisterDates } from '@/lib/report/call-register/dates';
import { isCallRegisterClient } from '@/lib/report/call-register/clients';
import {
  callRegisterSerialExportFilename,
  fetchCallRegisterSerialExportRows,
} from '@/lib/report/call-register/serial-export';
import { buildCallRegisterSerialWorkbook } from '@/lib/report/call-register/excel-export';
import { workbookToBuffer } from '@/lib/report/summary-excel-export';

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
      return NextResponse.json(
        { error: 'Select a valid client to export.' },
        { status: 400 }
      );
    }

    const { dateFrom, dateTo } = resolveCallRegisterDates(searchParams);
    const params = { dateFrom, dateTo };

    const rows = await fetchCallRegisterSerialExportRows(client, params);
    const workbook = await buildCallRegisterSerialWorkbook(rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = callRegisterSerialExportFilename(client, params);

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
