import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import {
  parseCallTypes,
  parseCsvFilter,
  querySummaryDashboard,
} from '@/sql/read-model/summary';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { queryAllClientBranchSummary, countClientRowsInRange } from '@/modules/mis/client-import/services/aggregate';
import {
  listAllSourcesWithBatches,
  sumCompletedBatchRowCounts,
} from '@/modules/mis/client-import/services/config';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'summary',
    });
    if (!auth.ok) return auth.response;
    const { security } = auth;

    const { searchParams } = new URL(req.url);
    const officeId = searchParams.get('officeId');
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf');
    const includeClient = searchParams.get('includeClient') === 'true';

    const assignedOffices = security.assignedOffices.map(String);
    const isHod = security.isHod;

    if (readSummaryFromPostgres()) {
      const result = await querySummaryDashboard({
        startDate,
        endDate,
        agingAsOf: agingAsOf || undefined,
        officeIds: parseCsvFilter(officeId),
        callTypes: parseCallTypes(callType),
        assignedOffices,
        isHod,
      });
      const syncMeta = await getSyncMeta();
      let clientBranchSummary;
      let clientMeta;
      if (includeClient) {
        clientBranchSummary = await queryAllClientBranchSummary({
          startDate,
          endDate,
          agingAsOf: agingAsOf || undefined,
        });
        const [sources, rowsInDateRange, totalRowsInFiles] = await Promise.all([
          listAllSourcesWithBatches(),
          countClientRowsInRange({
            sourceCode: 'all',
            startDate,
            endDate,
          }),
          sumCompletedBatchRowCounts(),
        ]);
        clientMeta = {
          sources,
          rowsInDateRange,
          totalRowsInFiles,
        };
      }
      return NextResponse.json({
        ...result,
        clientBranchSummary,
        clientMeta,
        syncMeta,
        readSource: 'postgres',
      });
    }

    return NextResponse.json(
      {
        error:
          'MIS summary requires READ_SUMMARY_FROM=postgres. Set env flag for local CRM mode (deprecated).',
      },
      { status: 503 }
    );
  } catch (err: unknown) {
    console.error('Report Summary Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
