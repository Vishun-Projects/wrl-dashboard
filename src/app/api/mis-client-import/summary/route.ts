import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import {
  countClientRowsInRange,
  queryClientAccountSummaryFiltered,
  queryClientBranchSummaryFiltered,
} from '@/features/mis-import/lib/aggregate';
import { parseSourceCodesParam } from '@/features/mis-import/lib/source-selection';
import { listAllSourcesWithBatches } from '@/features/mis-import/lib/config';
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

    const clientBranchSummary = await queryClientBranchSummaryFiltered(aggregateParams);
    const clientAccountSummary = await queryClientAccountSummaryFiltered(aggregateParams);
    const sources = await listAllSourcesWithBatches();
    const rowsInDateRange = await countClientRowsInRange({
      sourceCodes,
      startDate,
      endDate,
    });
    const totalRowsInFiles = sources.reduce(
      (sum, s) => sum + s.batches.reduce((bSum, b) => bSum + b.rowCount, 0),
      0
    );

    return NextResponse.json({
      clientBranchSummary,
      clientAccountSummary,
      rowsInDateRange,
      totalRowsInFiles,
    });
  } catch (err: unknown) {
    console.error('MIS client import summary error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
