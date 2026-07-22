import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { listAllSourcesWithBatches, summarizeImportBatches } from '@/features/mis-import/lib/config';
import { countClientRowsInRange } from '@/features/mis-import/lib/aggregate';
import { canDeleteClientMis, canUploadClientMis } from '@/features/mis-import/lib/upload-access';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const userAuth = await loadUserAuth(auth.userId);
    const permissions = userAuth?.permissions ?? [];

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const sources = await listAllSourcesWithBatches();
    const stats = summarizeImportBatches(sources);
    let rowsInDateRange: number | null = null;
    const rowsInDateRangeBySource: Record<string, number> = {};
    if (startDate && endDate) {
      const [totalInRange, ...perSourceCounts] = await Promise.all([
        countClientRowsInRange({
          sourceCode: 'all',
          startDate,
          endDate,
        }),
        ...sources.map((source) =>
          countClientRowsInRange({
            sourceCodes: [source.sourceCode],
            startDate,
            endDate,
          })
        ),
      ]);
      rowsInDateRange = totalInRange;
      sources.forEach((source, i) => {
        rowsInDateRangeBySource[source.sourceCode] = perSourceCounts[i] ?? 0;
      });
    }

    return NextResponse.json({
      canUpload: canUploadClientMis(permissions),
      canDelete: canDeleteClientMis(permissions),
      sources,
      stats,
      rowsInDateRange,
      rowsInDateRangeBySource,
    });
  } catch (err: unknown) {
    console.error('MIS client import meta error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
