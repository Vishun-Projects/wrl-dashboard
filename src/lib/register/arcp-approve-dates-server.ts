import { prisma } from '@/lib/db/prisma';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import { arcpLinesHotHasCallNo } from '@/lib/read-model/arcp/hot-schema';
import { enrichRegisterRowArcpApproveDates } from '@/lib/register/arcp-approve-dates';

type ArcpPickByCall = {
  bm_approved_at: Date | null;
  ho_approved_at: Date | null;
};

/** Postgres register: BM/HO dates from arcp_lines_hot (CLI-safe — mis-email worker + API). */
export async function mergeArcpApproveDatesFromHot(
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;

  const hasArcpHot = await arcpLinesHotHasCallNo();
  if (!hasArcpHot) {
    return rows.map((r) => enrichRegisterRowArcpApproveDates(r));
  }

  const callIds = [
    ...new Set(
      rows
        .map((r) => String(r.id ?? r.ncode ?? '').trim())
        .filter((id) => id && id !== '0')
    ),
  ];
  if (!callIds.length) {
    return rows.map((r) => enrichRegisterRowArcpApproveDates(r));
  }

  const arcpRows = await prisma.$queryRawUnsafe<
    Array<{
      call_no: string;
      bm_approved_at: Date | null;
      ho_approved_at: Date | null;
    }>
  >(
    `
    SELECT DISTINCT ON (call_no)
      call_no,
      bm_approved_at,
      ho_approved_at
    FROM arcp_lines_hot
    WHERE call_no = ANY($1::text[])
      AND NOT is_rejected
    ORDER BY
      call_no,
      CASE WHEN ho_approved_at IS NOT NULL THEN 1 ELSE 0 END DESC,
      ho_approved_at DESC NULLS LAST,
      bm_approved_at DESC NULLS LAST,
      ncode DESC
    `,
    callIds
  );

  const byCall = new Map<string, ArcpPickByCall>();
  for (const r of arcpRows) {
    const key = String(r.call_no ?? '').trim();
    if (!key) continue;
    byCall.set(key, {
      bm_approved_at: r.bm_approved_at,
      ho_approved_at: r.ho_approved_at,
    });
  }

  return rows.map((row) => {
    const id = String(row.id ?? row.ncode ?? '').trim();
    const hit = byCall.get(id);
    if (!hit) {
      return {
        ...enrichRegisterRowArcpApproveDates(row),
        bm_approved_date: '',
        ho_approved_date: '',
      };
    }
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
