import type pg from 'pg';
import { prisma } from '@/lib/db/prisma';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import { arcpLinesHotHasCallNo } from '@/lib/read-model/arcp/hot-schema';
import { enrichRegisterRowArcpApproveDates } from '@/lib/register/arcp-approve-dates';

type ArcpPickByCall = {
  bm_approved_at: Date | null;
  ho_approved_at: Date | null;
};

const ARCP_PICK_BY_CALL_NOS_SQL = `
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
`;

async function fetchArcpPickByCallNos(
  callIds: string[],
  query?: (sql: string, params: unknown[]) => Promise<pg.QueryResult>
): Promise<Map<string, ArcpPickByCall>> {
  if (!callIds.length) return new Map();

  const arcpRows = query
    ? (
        await query(ARCP_PICK_BY_CALL_NOS_SQL, [callIds])
      ).rows as Array<{
        call_no: string;
        bm_approved_at: Date | null;
        ho_approved_at: Date | null;
      }>
    : await prisma.$queryRawUnsafe<
        Array<{
          call_no: string;
          bm_approved_at: Date | null;
          ho_approved_at: Date | null;
        }>
      >(ARCP_PICK_BY_CALL_NOS_SQL, callIds);

  const byCall = new Map<string, ArcpPickByCall>();
  for (const r of arcpRows) {
    const key = String(r.call_no ?? '').trim();
    if (!key) continue;
    byCall.set(key, {
      bm_approved_at: r.bm_approved_at,
      ho_approved_at: r.ho_approved_at,
    });
  }
  return byCall;
}

/** Batch ARCP BM/HO dates onto hot-table export rows (avoids per-row LATERAL in cursor SQL). */
export async function mergeArcpPickOntoHotExportRows(
  rows: Record<string, unknown>[],
  query?: (sql: string, params: unknown[]) => Promise<pg.QueryResult>
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;
  if (!(await arcpLinesHotHasCallNo())) return rows;

  const callIds = [
    ...new Set(
      rows
        .map((r) => String(r.ncode ?? '').trim())
        .filter((id) => id && id !== '0')
    ),
  ];
  if (!callIds.length) return rows;

  const byCall = await fetchArcpPickByCallNos(callIds, query);
  if (!byCall.size) return rows;

  return rows.map((row) => {
    const id = String(row.ncode ?? '').trim();
    const hit = byCall.get(id);
    if (!hit) return row;
    return {
      ...row,
      bm_approved_at: hit.bm_approved_at,
      ho_approved_at: hit.ho_approved_at,
    };
  });
}

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

  const byCall = await fetchArcpPickByCallNos(callIds);

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
