import type pg from 'pg';
import { prisma } from '@/lib/db/prisma';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import { arcpLinesHotHasCallNo } from '@/lib/read-model/arcp/hot-schema';
import { enrichRegisterRowArcpApproveDates } from '@/lib/register-sql/arcp-approve-dates';

type ArcpPickByCall = {
  bm_approved_at: Date | null;
  ho_approved_at: Date | null;
};

/**
 * Prefer unique Service Order: arcp.vucnno = register vtrnno.
 * Matching on ncode/call_no alone can attach another call's ARCP (ncode can repeat; call id does not).
 */
const ARCP_PICK_BY_VUCNNO_SQL = `
  SELECT DISTINCT ON (upper(trim(vucnno)))
    trim(vucnno) AS call_key,
    bm_approved_at,
    ho_approved_at
  FROM arcp_lines_hot
  WHERE NULLIF(trim(vucnno), '') IS NOT NULL
    AND upper(trim(vucnno)) = ANY($1::text[])
    AND NOT is_rejected
  ORDER BY
    upper(trim(vucnno)),
    CASE WHEN ho_approved_at IS NOT NULL THEN 1 ELSE 0 END DESC,
    ho_approved_at DESC NULLS LAST,
    bm_approved_at DESC NULLS LAST,
    ncode DESC
`;

/** Fallback only when ARCP line has no vucnno (legacy). */
const ARCP_PICK_BY_CALL_NOS_FALLBACK_SQL = `
  SELECT DISTINCT ON (call_no)
    call_no AS call_key,
    bm_approved_at,
    ho_approved_at
  FROM arcp_lines_hot
  WHERE call_no = ANY($1::text[])
    AND NULLIF(trim(vucnno), '') IS NULL
    AND NOT is_rejected
  ORDER BY
    call_no,
    CASE WHEN ho_approved_at IS NOT NULL THEN 1 ELSE 0 END DESC,
    ho_approved_at DESC NULLS LAST,
    bm_approved_at DESC NULLS LAST,
    ncode DESC
`;

/** One round-trip per register export page (was 2k → ~25 queries/page and multi-minute exports). */
const ARCP_CALL_ID_BATCH_SIZE = 50_000;

export function normalizeRegisterArcpCallKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function registerRowCallId(row: Record<string, unknown>): string {
  return normalizeRegisterArcpCallKey(row.UniqueCallNo ?? row.vtrnno ?? row.uniqueCallNo);
}

function registerRowNcode(row: Record<string, unknown>): string {
  return String(row.id ?? row.ncode ?? '').trim();
}

async function fetchArcpPickMap(
  sql: string,
  keys: string[],
  query?: (sql: string, params: unknown[]) => Promise<pg.QueryResult>
): Promise<Map<string, ArcpPickByCall>> {
  const byCall = new Map<string, ArcpPickByCall>();
  if (!keys.length) return byCall;

  for (let index = 0; index < keys.length; index += ARCP_CALL_ID_BATCH_SIZE) {
    const batch = keys.slice(index, index + ARCP_CALL_ID_BATCH_SIZE);
    const arcpRows = query
      ? (
          await query(sql, [batch])
        ).rows as Array<{
          call_key: string;
          bm_approved_at: Date | null;
          ho_approved_at: Date | null;
        }>
      : await prisma.$queryRawUnsafe<
          Array<{
            call_key: string;
            bm_approved_at: Date | null;
            ho_approved_at: Date | null;
          }>
        >(sql, batch);

    for (const r of arcpRows) {
      const key = normalizeRegisterArcpCallKey(r.call_key);
      if (!key) continue;
      byCall.set(key, {
        bm_approved_at: r.bm_approved_at,
        ho_approved_at: r.ho_approved_at,
      });
    }
  }

  return byCall;
}

async function resolveArcpPicksForRegisterRows(
  rows: Record<string, unknown>[],
  query?: (sql: string, params: unknown[]) => Promise<pg.QueryResult>
): Promise<Map<string, ArcpPickByCall>> {
  const callIds = [
    ...new Set(rows.map(registerRowCallId).filter((id) => id && id !== '0')),
  ];
  const byCall = await fetchArcpPickMap(ARCP_PICK_BY_VUCNNO_SQL, callIds, query);

  const unmatched = rows.filter((row) => {
    const callId = registerRowCallId(row);
    return !callId || !byCall.has(callId);
  });
  if (!unmatched.length) return byCall;
  if (!(await arcpLinesHotHasCallNo())) return byCall;

  const ncodes = [
    ...new Set(unmatched.map(registerRowNcode).filter((id) => id && id !== '0')),
  ];
  if (!ncodes.length) return byCall;

  const byNcode = await fetchArcpPickMap(ARCP_PICK_BY_CALL_NOS_FALLBACK_SQL, ncodes, query);
  for (const [ncode, pick] of byNcode) {
    byCall.set(`ncode:${ncode}`, pick);
  }
  return byCall;
}

function pickForRow(
  row: Record<string, unknown>,
  byCall: Map<string, ArcpPickByCall>
): ArcpPickByCall | undefined {
  const callId = registerRowCallId(row);
  if (callId) {
    const hit = byCall.get(callId);
    if (hit) return hit;
  }
  const ncode = registerRowNcode(row);
  if (ncode) return byCall.get(`ncode:${ncode}`);
  return undefined;
}

/** Batch ARCP BM/HO dates onto hot-table export rows (avoids per-row LATERAL in cursor SQL). */
export async function mergeArcpPickOntoHotExportRows(
  rows: Record<string, unknown>[],
  query?: (sql: string, params: unknown[]) => Promise<pg.QueryResult>
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;

  const byCall = await resolveArcpPicksForRegisterRows(rows, query);
  if (!byCall.size) return rows;

  return rows.map((row) => {
    const hit = pickForRow(row, byCall);
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

  const byCall = await resolveArcpPicksForRegisterRows(rows);
  if (!byCall.size) {
    return rows.map((r) => enrichRegisterRowArcpApproveDates(r));
  }

  return rows.map((row) => {
    const hit = pickForRow(row, byCall);
    if (!hit) {
      return enrichRegisterRowArcpApproveDates(row);
    }
    return {
      ...row,
      bm_approved_at: hit.bm_approved_at,
      ho_approved_at: hit.ho_approved_at,
      bm_approved_date: hit.bm_approved_at
        ? formatArcpClaimsExportDate(hit.bm_approved_at)
        : '',
      ho_approved_date: hit.ho_approved_at
        ? formatArcpClaimsExportDate(hit.ho_approved_at)
        : '',
    };
  });
}
