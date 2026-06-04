import { withClient } from '@/lib/read-model/db';
import { postQuery } from '@/lib/db/proxy';
import {
  isTruthyCrmRowFlag,
  resolveTrhcallsBmApprovedAt,
} from '@/lib/trhcalls/bm-approval';
import { callsHotHasBmApprovalColumns } from '@/lib/read-model/calls-hot-schema';

const BATCH_SIZE = Number(process.env.BM_APPROVAL_BACKFILL_BATCH ?? 50) || 50;
const CRM_TIMEOUT_MS = Number(process.env.BM_APPROVAL_BACKFILL_TIMEOUT_MS ?? 180_000) || 180_000;

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

async function fetchHotBatch(offset: number, onlyMissing: boolean): Promise<string[]> {
  return withClient(async (client) => {
    const missingClause = onlyMissing ? 'AND bm_approved_at IS NULL' : '';
    const result = await client.query<{ vtrnno: string }>(
      `
      SELECT vtrnno
      FROM calls_latest_hot
      WHERE vtrnno IS NOT NULL AND TRIM(vtrnno) <> ''
      ${missingClause}
      ORDER BY vtrnno
      OFFSET $1 LIMIT $2
      `,
      [offset, BATCH_SIZE]
    );
    return result.rows.map((r) => String(r.vtrnno).trim()).filter(Boolean);
  });
}

async function countHotTargets(onlyMissing: boolean): Promise<number> {
  return withClient(async (client) => {
    const missingClause = onlyMissing ? 'AND bm_approved_at IS NULL' : '';
    const result = await client.query<{ count: number }>(
      `
      SELECT COUNT(*)::int AS count
      FROM calls_latest_hot
      WHERE vtrnno IS NOT NULL AND TRIM(vtrnno) <> ''
      ${missingClause}
      `
    );
    return result.rows[0]?.count ?? 0;
  });
}

async function fetchBmFromCrm(vtrnnos: string[]): Promise<Map<string, { bapproval: boolean; bmAt: Date | null }>> {
  if (vtrnnos.length === 0) return new Map();

  const inList = vtrnnos.map((v) => `'${escapeSql(v)}'`).join(', ');
  const sql = `
SELECT
  NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') AS vtrnno,
  tc.bapproval,
  CONVERT(varchar(30), tc.editedon, 126) AS editedon,
  CONVERT(varchar(30), tc.addedon, 126) AS addedon
FROM (
  SELECT
    tc.*,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')
      ORDER BY ISNULL(tc.editedon, tc.addedon) DESC, CAST(tc.ncode AS VARCHAR(50)) DESC
    ) AS rn
  FROM trhcalls tc (NOLOCK)
  WHERE NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') IN (${inList})
) tc
WHERE tc.rn = 1`;

  let res: Awaited<ReturnType<typeof postQuery>>;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await postQuery({ rawSql: sql, timeoutMs: CRM_TIMEOUT_MS });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/timeout|Timeout expired/i.test(msg)) throw err;
      console.warn(`[backfill-bm] CRM timeout (attempt ${attempt}/3), retrying smaller slice…`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  const out = new Map<string, { bapproval: boolean; bmAt: Date | null }>();

  for (const row of (res!.data ?? []) as Record<string, unknown>[]) {
    const vtrnno = String(row.vtrnno ?? '').trim();
    if (!vtrnno) continue;
    const bapproval = isTruthyCrmRowFlag(row.bapproval);
    out.set(vtrnno, {
      bapproval,
      bmAt: bapproval ? resolveTrhcallsBmApprovedAt(row) : null,
    });
  }

  return out;
}

async function applyBatch(updates: { vtrnno: string; bapproval: boolean; bmAt: Date | null }[]): Promise<number> {
  if (updates.length === 0) return 0;

  return withClient(async (client) => {
    let updated = 0;
    for (const row of updates) {
      const result = await client.query(
        `
        UPDATE calls_latest_hot
        SET
          bapproval = $2,
          bm_approved_at = $3,
          synced_at = now()
        WHERE vtrnno = $1
        `,
        [row.vtrnno, row.bapproval, row.bmAt]
      );
      updated += result.rowCount ?? 0;
    }
    return updated;
  });
}

export type BackfillBmApprovalResult = {
  ok: boolean;
  reason?: string;
  totalTargets: number;
  batches: number;
  rowsUpdated: number;
  rowsWithBmApproval: number;
};

/**
 * One-time fill of calls_latest_hot.bapproval / bm_approved_at from live trhcalls.
 * Does not truncate or delete any rows.
 */
export async function runBackfillCallsHotBmApproval(opts?: {
  onlyMissing?: boolean;
}): Promise<BackfillBmApprovalResult> {
  const onlyMissing = opts?.onlyMissing !== false;

  if (!(await callsHotHasBmApprovalColumns())) {
    return {
      ok: false,
      reason: 'Run docs/read-model-phase1-schema/11-calls_hot_bm_approval.sql first',
      totalTargets: 0,
      batches: 0,
      rowsUpdated: 0,
      rowsWithBmApproval: 0,
    };
  }

  const totalTargets = await countHotTargets(onlyMissing);
  console.log(
    `[backfill-bm] ${totalTargets.toLocaleString()} calls_latest_hot row(s) to refresh from CRM (onlyMissing=${onlyMissing})`
  );

  let offset = 0;
  let batches = 0;
  let rowsUpdated = 0;
  let rowsWithBmApproval = 0;

  while (offset < totalTargets) {
    const vtrnnos = await fetchHotBatch(offset, onlyMissing);
    if (vtrnnos.length === 0) break;

    let fromCrm: Map<string, { bapproval: boolean; bmAt: Date | null }>;
    try {
      fromCrm = await fetchBmFromCrm(vtrnnos);
    } catch (err) {
      console.warn(
        `[backfill-bm] batch ${batches + 1} CRM failed, skipping:`,
        err instanceof Error ? err.message : err
      );
      offset += vtrnnos.length;
      continue;
    }
    const updates = vtrnnos.map((vtrnno) => {
      const hit = fromCrm.get(vtrnno);
      return {
        vtrnno,
        bapproval: hit?.bapproval ?? false,
        bmAt: hit?.bmAt ?? null,
      };
    });

    const batchUpdated = await applyBatch(updates);
    const batchBm = updates.filter((u) => u.bapproval && u.bmAt).length;

    rowsUpdated += batchUpdated;
    rowsWithBmApproval += batchBm;
    batches += 1;
    offset += vtrnnos.length;

    console.log(
      `[backfill-bm] batch ${batches}: ${vtrnnos.length} vtrnno, ${batchBm} BM-approved, ${batchUpdated} rows updated`
    );
  }

  return {
    ok: true,
    totalTargets,
    batches,
    rowsUpdated,
    rowsWithBmApproval,
  };
}
