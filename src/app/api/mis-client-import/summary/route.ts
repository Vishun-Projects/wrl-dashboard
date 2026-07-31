import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { queryClientAggregates } from '@/features/mis-import/services/aggregate';
import { parseSourceCodesParam } from '@/features/mis-import/services/source-selection';
import { sumCompletedBatchRowCounts } from '@/features/mis-import/services/config';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf');
    const sourceCodes = parseSourceCodesParam(searchParams.get('sourceCodes'));

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    const aggregateParams = {
      startDate,
      endDate,
      agingAsOf: agingAsOf || undefined,
      sourceCodes,
    };

    const [{ branchSummary, accountSummary, rowsInDateRange }, totalRowsInFiles] =
      await Promise.all([
        queryClientAggregates(aggregateParams),
        sumCompletedBatchRowCounts(sourceCodes),
      ]);

    return NextResponse.json({
      clientBranchSummary: branchSummary,
      clientAccountSummary: accountSummary,
      rowsInDateRange,
      totalRowsInFiles,
    });
  } catch (err: unknown) {
    console.error('MIS client import summary error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
