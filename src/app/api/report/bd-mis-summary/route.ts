import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import {
  parseCallTypes,
  parseCsvFilter,
} from '@/lib/read-model/queries/summary';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/lib/mis-client-import/aggregate';
import {
  buildBdMisRegionalRows,
  bdMisSourcesFromSelection,
  sumBdMisRegionalGrand,
} from '@/lib/report/bd-mis-summary';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'bd_mis_summary',
    });
    if (!auth.ok) return auth.response;
    const { security } = auth;

    if (!readSummaryFromPostgres()) {
      return NextResponse.json(
        { error: 'BD MIS summary requires Postgres read model.' },
        { status: 501 }
      );
    }

    const { searchParams } = new URL(req.url);
    const officeId = searchParams.get('officeId');
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf');
    const includeCrm = searchParams.get('includeCrm') !== 'false';
    const clientSources = (searchParams.get('clientSources') ?? 'coke,cadbury')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const assignedOffices = security.assignedOffices.map(String);
    const isHod = security.isHod;

    const crm = await queryBdMisCrmSummary({
      startDate,
      endDate,
      agingAsOf: agingAsOf || undefined,
      officeIds: parseCsvFilter(officeId),
      callTypes: parseCallTypes(callType),
      assignedOffices,
      isHod,
    });

    const clientAccountSummary = await queryClientAccountSummaryForBdMis({
      startDate,
      endDate,
      agingAsOf: agingAsOf || undefined,
      sourceCodes: clientSources,
    });

    const sources = bdMisSourcesFromSelection(includeCrm, clientSources);
    const regionalRows = buildBdMisRegionalRows({
      crmBranchSummary: crm.branchSummary,
      crmAccountSummary: crm.accountSummary,
      clientAccountSummary,
      sources,
    });
    const grand = sumBdMisRegionalGrand(regionalRows);
    const syncMeta = await getSyncMeta();

    return NextResponse.json({
      regionalRows,
      grand,
      crmBranchSummary: crm.branchSummary,
      crmAccountSummary: crm.accountSummary,
      clientAccountSummary,
      sources,
      syncMeta,
      readSource: 'postgres',
    });
  } catch (err: unknown) {
    console.error('BD MIS Summary Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
