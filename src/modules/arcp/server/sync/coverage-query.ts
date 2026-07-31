/** Node/CLI-safe — no `server-only` (used by sync worker and Next server routes). */

import { withClient } from '@/lib/read-model/db';
import { getArcpSyncState } from '@/modules/arcp/server/sync/lock';
import { countArcpRows } from '@/modules/arcp/server/sync/upsert';
import { arcpBackfillStartDate } from '@/modules/arcp/server/sync/dates';
import type { ArcpPostgresCoverage } from '@/modules/arcp/server/sync/coverage-shared';

function toYmd(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let coverageCache: { at: number; data: ArcpPostgresCoverage } | null = null;
const COVERAGE_CACHE_MS = Number(process.env.ARCP_COVERAGE_CACHE_MS ?? 30_000) || 30_000;

export async function getArcpPostgresCoverage(force = false): Promise<ArcpPostgresCoverage> {
  if (
    !force &&
    coverageCache &&
    Date.now() - coverageCache.at < COVERAGE_CACHE_MS
  ) {
    return coverageCache.data;
  }

  const data = await withClient(async (client) => {
    const state = await client.query(
      `SELECT status FROM sync_state WHERE entity = 'arcp_lines_hot' LIMIT 1`
    );
    const bounds = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM arcp_lines_hot) AS row_count,
        (SELECT MIN(call_at) FROM arcp_lines_hot WHERE call_at IS NOT NULL) AS min_call,
        (SELECT MAX(call_at) FROM arcp_lines_hot WHERE call_at IS NOT NULL) AS max_call,
        (SELECT MIN(solve_at) FROM arcp_lines_hot WHERE solve_at IS NOT NULL) AS min_solve,
        (SELECT MAX(solve_at) FROM arcp_lines_hot WHERE solve_at IS NOT NULL) AS max_solve,
        (SELECT MIN(bm_approved_at) FROM arcp_lines_hot WHERE bm_approved_at IS NOT NULL) AS min_bm,
        (SELECT MAX(bm_approved_at) FROM arcp_lines_hot WHERE bm_approved_at IS NOT NULL) AS max_bm,
        (SELECT MIN(ho_approved_at) FROM arcp_lines_hot WHERE ho_approved_at IS NOT NULL) AS min_ho,
        (SELECT MAX(ho_approved_at) FROM arcp_lines_hot WHERE ho_approved_at IS NOT NULL) AS max_ho
    `);
    const row = bounds.rows[0] ?? {};
    return {
      rowCount: Number(row.row_count ?? 0),
      status: (state.rows[0]?.status as string | undefined) ?? null,
      backfillStart: arcpBackfillStartDate(),
      callAt: { min: toYmd(row.min_call), max: toYmd(row.max_call) },
      solveAt: { min: toYmd(row.min_solve), max: toYmd(row.max_solve) },
      bmApprovedAt: { min: toYmd(row.min_bm), max: toYmd(row.max_bm) },
      hoApprovedAt: { min: toYmd(row.min_ho), max: toYmd(row.max_ho) },
    };
  });

  coverageCache = { at: Date.now(), data };
  return data;
}

export function invalidateArcpPostgresCoverageCache(): void {
  coverageCache = null;
}

export type ArcpReadiness = {
  ready: boolean;
  reason?: string;
  rowCount: number;
  status: string | null;
};

export async function getArcpReadiness(): Promise<ArcpReadiness> {
  return withClient(async (client) => {
    const state = await getArcpSyncState(client);
    const rowCount = await countArcpRows(client);
    const status = state?.status ?? null;

    if (status === 'pending_backfill' && rowCount === 0) {
      return {
        ready: false,
        reason: 'ARCP claims data is still loading — try again later or contact your administrator.',
        rowCount,
        status,
      };
    }

    if (status === 'backfilling' && rowCount === 0) {
      return {
        ready: false,
        reason: 'ARCP backfill in progress — no rows loaded yet',
        rowCount,
        status,
      };
    }

    if (rowCount === 0) {
      return {
        ready: false,
        reason: 'ARCP claims cache is empty — contact your administrator.',
        rowCount,
        status,
      };
    }

    return { ready: true, rowCount, status };
  });
}
