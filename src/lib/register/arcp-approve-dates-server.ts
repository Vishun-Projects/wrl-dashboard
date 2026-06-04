import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import { callsHotHasBmApprovalColumns } from '@/lib/read-model/calls-hot-schema';
import { enrichRegisterRowArcpApproveDates } from '@/lib/register/arcp-approve-dates';

/** Postgres register: BM dates from calls_latest_hot (trhcalls basis), not arcp_lines_hot. */
export async function mergeArcpApproveDatesFromHot(
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;

  const hasBmColumns = await callsHotHasBmApprovalColumns();
  if (!hasBmColumns) {
    return rows.map((r) => enrichRegisterRowArcpApproveDates(r));
  }

  const callIds = [
    ...new Set(
      rows
        .map((r) => String(r.id ?? r.ncode ?? '').trim())
        .filter((id) => id && id !== '0')
    ),
  ];
  if (!callIds.length) return rows;

  const hotRows = await prisma.$queryRawUnsafe<
    Array<{
      ncode_key: string;
      vtrnno: string;
      bm_approved_at: Date | null;
    }>
  >(
    `
    SELECT
      CAST(ncode AS TEXT) AS ncode_key,
      vtrnno::text AS vtrnno,
      bm_approved_at
    FROM calls_latest_hot
    WHERE CAST(ncode AS TEXT) = ANY($1::text[])
       OR vtrnno = ANY($1::text[])
    `,
    callIds
  );

  const byCall = new Map<string, Date | null>();
  for (const r of hotRows) {
    if (!r.bm_approved_at) continue;
    if (r.ncode_key) byCall.set(r.ncode_key, r.bm_approved_at);
    if (r.vtrnno) byCall.set(r.vtrnno, r.bm_approved_at);
  }

  return rows.map((row) => {
    const id = String(row.id ?? row.ncode ?? '').trim();
    const hit = byCall.get(id);
    const enriched = enrichRegisterRowArcpApproveDates(row);
    if (!hit) return enriched;
    return {
      ...enriched,
      bm_approved_date: formatArcpClaimsExportDate(hit),
    };
  });
}
