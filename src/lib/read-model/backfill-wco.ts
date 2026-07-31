import { withClient } from '@/lib/read-model/db';
import { postQuery } from '@/lib/db/proxy';
import { SQL_WCO_EXPR } from '@/sql/register/wco';

const CRM_TIMEOUT_MS = Number(process.env.WCO_BACKFILL_TIMEOUT_MS ?? 240_000) || 240_000;
/** CRM day chunk size in hours when a full-day query times out. */
const HOUR_CHUNK = Number(process.env.WCO_BACKFILL_HOUR_CHUNK ?? 6) || 6;

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeWco(raw: unknown): string | null {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase();
  return text === 'W' || text === 'C' || text === 'O' || text === 'V' ? text : null;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function eachCalendarDay(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  const cur = parseYmd(fromDate);
  const end = parseYmd(toDate);
  while (cur <= end) {
    days.push(formatYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export type BackfillWcoOptions = {
  /** Inclusive calendar start YYYY-MM-DD (CRM dtrndate / hot logged_at). */
  fromDate?: string | null;
  /** Inclusive calendar end YYYY-MM-DD. */
  toDate?: string | null;
};

async function callsHotHasWcoColumn(): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calls_latest_hot'
          AND column_name = 'wco'
      ) AS exists
    `);
    return Boolean(result.rows[0]?.exists);
  });
}

async function fetchWcoCrmWindow(startIso: string, endExclusiveIso: string): Promise<Map<string, string>> {
  const startSafe = escapeSql(startIso);
  const endSafe = escapeSql(endExclusiveIso);
  const sql = `
SELECT
  NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') AS vtrnno,
  (${SQL_WCO_EXPR}) AS WCO
FROM (
  SELECT
    tc.*,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')
      ORDER BY ISNULL(tc.editedon, tc.addedon) DESC, CAST(tc.ncode AS VARCHAR(50)) DESC
    ) AS rn
  FROM trhcalls tc (NOLOCK)
  WHERE tc.dtrndate >= '${startSafe}'
    AND tc.dtrndate < '${endSafe}'
    AND NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') IS NOT NULL
) tc
LEFT JOIN mstprorg po (NOLOCK) ON tc.nitemserialno = po.ncode
WHERE tc.rn = 1`;

  let res: Awaited<ReturnType<typeof postQuery>> | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await postQuery({ rawSql: sql, timeoutMs: CRM_TIMEOUT_MS });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= 3) throw err;
      if (!/timeout|Timeout expired|out of memory|OOM/i.test(msg)) throw err;
      console.warn(`[backfill-wco] CRM window timeout ${startIso}→${endExclusiveIso} (attempt ${attempt}/3)`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  const out = new Map<string, string>();
  for (const row of (res!.data ?? []) as Record<string, unknown>[]) {
    const vtrnno = String(row.vtrnno ?? '').trim();
    if (!vtrnno) continue;
    // '' marks looked-up with no W/C/O/V so callers can distinguish miss vs letter
    out.set(vtrnno, normalizeWco(row.WCO ?? row.wco) ?? '');
  }
  return out;
}

async function fetchWcoCrmDay(day: string): Promise<Map<string, string>> {
  const next = parseYmd(day);
  next.setDate(next.getDate() + 1);
  const nextDay = formatYmd(next);
  try {
    return await fetchWcoCrmWindow(`${day} 00:00:00`, `${nextDay} 00:00:00`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/timeout|Timeout expired|out of memory|OOM/i.test(msg)) throw err;
    console.warn(`[backfill-wco] splitting ${day} into ${HOUR_CHUNK}h chunks…`);
    const merged = new Map<string, string>();
    for (let hour = 0; hour < 24; hour += HOUR_CHUNK) {
      const startH = String(hour).padStart(2, '0');
      const endHour = hour + HOUR_CHUNK;
      const endIso =
        endHour >= 24 ? `${nextDay} 00:00:00` : `${day} ${String(endHour).padStart(2, '0')}:00:00`;
      const chunk = await fetchWcoCrmWindow(`${day} ${startH}:00:00`, endIso);
      for (const [k, v] of chunk) merged.set(k, v);
      console.log(`[backfill-wco]   ${day} ${startH}:00 → ${chunk.size} CRM rows`);
    }
    return merged;
  }
}

async function applyMap(fromCrm: Map<string, string>): Promise<number> {
  const updates = [...fromCrm.entries()];
  if (updates.length === 0) return 0;

  const CHUNK = 500;
  let updated = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < slice.length; j++) {
      const base = j * 2;
      placeholders.push(`($${base + 1}::text, $${base + 2}::varchar)`);
      values.push(slice[j][0], slice[j][1]);
    }
    const count = await withClient(async (client) => {
      const result = await client.query(
        `
        UPDATE calls_latest_hot AS h
        SET wco = v.wco, synced_at = now()
        FROM (VALUES ${placeholders.join(', ')}) AS v(vtrnno, wco)
        WHERE h.vtrnno = v.vtrnno
        `,
        values
      );
      return result.rowCount ?? 0;
    });
    updated += count;
  }
  return updated;
}

export type BackfillWcoResult = {
  ok: boolean;
  reason?: string;
  fromDate: string | null;
  toDate: string | null;
  days: number;
  crmRows: number;
  rowsUpdated: number;
  byLetter: Record<string, number>;
};

/**
 * Fill calls_latest_hot.wco from live CRM by calendar day windows (fast).
 * Requires --from / --to (or env WCO_BACKFILL_FROM / WCO_BACKFILL_TO).
 */
export async function runBackfillCallsHotWco(
  opts: BackfillWcoOptions = {}
): Promise<BackfillWcoResult> {
  const fromDate = opts.fromDate?.trim() || null;
  const toDate = opts.toDate?.trim() || null;

  if (!(await callsHotHasWcoColumn())) {
    return {
      ok: false,
      reason: 'Run docs/read-model-phase1-schema/18-calls_hot_wco.sql first',
      fromDate,
      toDate,
      days: 0,
      crmRows: 0,
      rowsUpdated: 0,
      byLetter: {},
    };
  }

  if (!fromDate || !toDate) {
    return {
      ok: false,
      reason: 'Provide --from YYYY-MM-DD and --to YYYY-MM-DD',
      fromDate,
      toDate,
      days: 0,
      crmRows: 0,
      rowsUpdated: 0,
      byLetter: {},
    };
  }

  const days = eachCalendarDay(fromDate, toDate);
  console.log(`[backfill-wco] ${days.length} day(s) ${fromDate} → ${toDate}`);

  let crmRows = 0;
  let rowsUpdated = 0;
  const byLetter: Record<string, number> = { W: 0, C: 0, O: 0, V: 0, blank: 0 };

  for (const day of days) {
    let map: Map<string, string>;
    try {
      map = await fetchWcoCrmDay(day);
    } catch (err) {
      console.warn(`[backfill-wco] day ${day} failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    crmRows += map.size;
    for (const wco of map.values()) {
      if (wco === 'W' || wco === 'C' || wco === 'O' || wco === 'V') byLetter[wco] += 1;
      else byLetter.blank += 1;
    }

    const updated = await applyMap(map);
    rowsUpdated += updated;
    console.log(`[backfill-wco] ${day}: CRM=${map.size}, hot updated=${updated}`);
  }

  return {
    ok: true,
    fromDate,
    toDate,
    days: days.length,
    crmRows,
    rowsUpdated,
    byLetter,
  };
}
