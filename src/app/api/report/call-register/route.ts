import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { fetchCallRegisterRows } from '@/features/report/lib/call-register';
import { resolveCallRegisterDates } from '@/features/report/lib/call-register/dates';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'deployment_completion',
    });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const { dateFrom, dateTo } = resolveCallRegisterDates(searchParams);

    const { rows, summary } = await fetchCallRegisterRows({ dateFrom, dateTo });

    return NextResponse.json({ rows, summary });
  } catch (err) {
    console.error('[call-register]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
