import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import { arcpLinesHotHasCallNo } from '@/lib/read-model/arcp/hot-schema';
import { enrichRegisterRowArcpApproveDates } from '@/lib/register/arcp-approve-dates';

/** Postgres register: merge max BM/HO dates from arcp_lines_hot by call id. */
export async function mergeArcpApproveDatesFromHot(
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;
  const hasCallNo = await arcpLinesHotHasCallNo();
  if (!hasCallNo) return rows.map((r) => enrichRegisterRowArcpApproveDates(r));

  const callIds = [
    ...new Set(
      rows
        .map((r) => String(r.id ?? r.ncode ?? '').trim())
        .filter((id) => id && id !== '0')
    ),
  ];
  if (!callIds.length) return rows;

  const arcpRows = await prisma.$queryRawUnsafe<
    Array<{ call_no: string; bm_approved_at: Date | null; ho_approved_at: Date | null }>
  >(
    `
    SELECT call_no::text AS call_no,
      MAX(bm_approved_at) AS bm_approved_at,
      MAX(ho_approved_at) AS ho_approved_at
    FROM arcp_lines_hot
    WHERE call_no = ANY($1::text[])
    GROUP BY call_no
    `,
    callIds
  );

  const byCall = new Map(
    arcpRows.map((r) => [
      r.call_no,
      {
        bm_approved_at: r.bm_approved_at,
        ho_approved_at: r.ho_approved_at,
      },
    ])
  );

  return rows.map((row) => {
    const id = String(row.id ?? row.ncode ?? '').trim();
    const hit = byCall.get(id);
    if (!hit) return enrichRegisterRowArcpApproveDates(row);
    return {
      ...row,
      bm_approved_date: hit.bm_approved_at
        ? formatArcpClaimsExportDate(hit.bm_approved_at)
        : '',
      ho_approved_date: hit.ho_approved_at
        ? formatArcpClaimsExportDate(hit.ho_approved_at)
        : '',
    };
  });
}
