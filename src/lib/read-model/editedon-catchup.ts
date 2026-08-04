import { withClient } from '@/lib/read-model/db';
import { fetchCrmEditedonDayWindow } from '@/lib/read-model/crm-fetch';
import { splitDateRangeByDays, todayLocalDate } from '@/lib/read-model/dates';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import {
  getSyncState,
  releaseSyncLock,
  releaseStaleSyncLock,
  tryAcquireSyncLock,
} from '@/lib/read-model/lock';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { formatLocalDate } from '@/lib/dates/local-date';

const CATCHUP_ENTITY = 'calls_latest_hot_editedon_catchup';
const FETCH_GAP_MS = Number(process.env.SYNC_CRM_FETCH_GAP_MS ?? 1500) || 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function catchupEnabled(): boolean {
  return process.env.SYNC_EDITEDON_CATCHUP_ENABLED !== 'false';
}

function daysPerIncrementalStep(): number {
  return Math.max(1, Number(process.env.SYNC_EDITEDON_CATCHUP_DAYS_PER_RUN ?? 1) || 1);
}

/** Always replay last N calendar days each incremental (BM closes land here fast). */
function recentDaysPerRun(): number {
  return Math.max(0, Number(process.env.SYNC_EDITEDON_RECENT_DAYS ?? 2) || 2);
}

export function recentEditedonDays(endDay: string, count: number): string[] {
  if (count <= 0) return [];
  const end = new Date(`${endDay}T00:00:00`);
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    days.push(formatLocalDate(d));
  }
  return days;
}

async function ensureCatchupState(client: import('pg').PoolClient): Promise<void> {
  const ytdStart = registerHotRetentionStart();
  await client.query(
    `
    INSERT INTO sync_state (entity, last_editedon, last_addedon, status)
    VALUES ($1, $2::timestamptz, NULL, 'ok')
    ON CONFLICT (entity) DO NOTHING
    `,
    [CATCHUP_ENTITY, `${ytdStart}T00:00:00`]
  );
}

async function readCatchupCursor(client: import('pg').PoolClient): Promise<string> {
  await ensureCatchupState(client);
  const row = await client.query<{ last_editedon: Date | null }>(
    `SELECT last_editedon FROM sync_state WHERE entity = $1`,
    [CATCHUP_ENTITY]
  );
  const raw = row.rows[0]?.last_editedon;
  return raw ? formatLocalDate(new Date(raw)) : registerHotRetentionStart();
}

async function writeCatchupCursor(client: import('pg').PoolClient, day: string): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET last_editedon = $2::timestamptz, last_run_at = now(), status = 'ok'
    WHERE entity = $1
    `,
    [CATCHUP_ENTITY, `${day}T00:00:00`]
  );
}

export type EditedonCatchupResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  daysProcessed?: number;
  rowsFetched?: number;
  rowsUpserted?: number;
  fromDay?: string;
  toDay?: string;
};

async function applyEditedonRows(
  rawRows: Record<string, unknown>[]
): Promise<{ rowsUpserted: number; rowsDeleted: number }> {
  if (!rawRows.length) return { rowsUpserted: 0, rowsDeleted: 0 };

  return withClient(async (client) => {
    await releaseStaleSyncLock(client);
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      throw new Error('sync lock not acquired');
    }
    try {
      const state = await getSyncState(client);
      // Catch-up must not advance main editedon watermark (that's incremental's job).
      const applied = await applyCrmRowsToHot(client, rawRows, {
        state,
        advanceWatermarks: false,
      });
      await releaseSyncLock(client, 'ok', applied.rowsUpserted);
      return { rowsUpserted: applied.rowsUpserted, rowsDeleted: applied.rowsDeleted };
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });
}

/** Replay one calendar day of CRM edits (addedon <> editedon) into hot. */
export async function runEditedonCatchupDay(day: string): Promise<EditedonCatchupResult> {
  const rows = await fetchCrmEditedonDayWindow(day, day);
  const applied = await applyEditedonRows(rows);
  await withClient((client) => writeCatchupCursor(client, day));
  console.log(
    `[sync-worker] Editedon catch-up ${day} — fetched ${rows.length}, upserted ${applied.rowsUpserted}`
  );
  return {
    ok: true,
    daysProcessed: 1,
    rowsFetched: rows.length,
    rowsUpserted: applied.rowsUpserted,
    fromDay: day,
    toDay: day,
  };
}

/**
 * Each incremental cycle:
 *  1) Always replay last N recent days (BM approval / status flips land here quickly)
 *  2) Advance the rotating YTD cursor by SYNC_EDITEDON_CATCHUP_DAYS_PER_RUN
 */
export async function runEditedonCatchupStep(): Promise<EditedonCatchupResult> {
  if (!catchupEnabled()) {
    return { ok: true, skipped: true, reason: 'SYNC_EDITEDON_CATCHUP_ENABLED=false' };
  }
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return { ok: false, skipped: true, reason: 'SYNC_WORKER_ENABLED is not true' };
  }

  const endDay = todayLocalDate();
  let totalFetched = 0;
  let totalUpserted = 0;
  let daysProcessed = 0;
  let fromDay: string | undefined;
  let toDay: string | undefined;

  // 1) Recent days — every run (does not move YTD cursor)
  const recentDays = recentEditedonDays(endDay, recentDaysPerRun());
  for (const day of recentDays) {
    const rows = await fetchCrmEditedonDayWindow(day, day);
    const applied = await applyEditedonRows(rows);
    totalFetched += rows.length;
    totalUpserted += applied.rowsUpserted;
    daysProcessed += 1;
    fromDay ??= day;
    toDay = day;
    console.log(
      `[sync-worker] Editedon recent ${day} — fetched ${rows.length}, upserted ${applied.rowsUpserted}`
    );
    await sleep(FETCH_GAP_MS);
  }

  // 2) Rotating YTD cursor (historical addedon <> editedon gaps)
  let cursor = await withClient((client) => readCatchupCursor(client));
  if (cursor > endDay) {
    await withClient((client) => writeCatchupCursor(client, registerHotRetentionStart()));
    cursor = registerHotRetentionStart();
  }

  const stepDays = daysPerIncrementalStep();
  const chunks = splitDateRangeByDays(cursor, endDay, stepDays).slice(0, stepDays);
  for (const chunk of chunks) {
    // Skip days already covered by the recent window this cycle
    if (recentDays.includes(chunk.start) && chunk.start === chunk.end) {
      await withClient((client) => writeCatchupCursor(client, chunk.end));
      continue;
    }
    const rows = await fetchCrmEditedonDayWindow(chunk.start, chunk.end);
    const applied = await applyEditedonRows(rows);
    totalFetched += rows.length;
    totalUpserted += applied.rowsUpserted;
    daysProcessed += 1;
    fromDay ??= chunk.start;
    toDay = chunk.end;
    await withClient((client) => writeCatchupCursor(client, chunk.end));
    console.log(
      `[sync-worker] Editedon catch-up ${chunk.start}..${chunk.end} — fetched ${rows.length}, upserted ${applied.rowsUpserted}`
    );
    await sleep(FETCH_GAP_MS);
  }

  if (!daysProcessed) {
    return { ok: true, skipped: true, reason: 'no catch-up days remaining' };
  }

  return {
    ok: true,
    daysProcessed,
    rowsFetched: totalFetched,
    rowsUpserted: totalUpserted,
    fromDay,
    toDay,
  };
}

/** Full replay: each calendar day in range, editedon BETWEEN day AND addedon <> editedon. */
export async function runEditedonCatchupRange(
  startDate: string,
  endDate: string
): Promise<EditedonCatchupResult> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return { ok: false, skipped: true, reason: 'SYNC_WORKER_ENABLED is not true' };
  }

  const chunks = splitDateRangeByDays(startDate, endDate, 1);
  let totalFetched = 0;
  let totalUpserted = 0;

  for (const chunk of chunks) {
    const rows = await fetchCrmEditedonDayWindow(chunk.start, chunk.end);
    const applied = await applyEditedonRows(rows);
    totalFetched += rows.length;
    totalUpserted += applied.rowsUpserted;
    console.log(
      `[sync-worker] Editedon catch-up ${chunk.start} — fetched ${rows.length}, upserted ${applied.rowsUpserted}`
    );
    await sleep(FETCH_GAP_MS);
  }

  await withClient((client) => writeCatchupCursor(client, endDate));

  return {
    ok: true,
    daysProcessed: chunks.length,
    rowsFetched: totalFetched,
    rowsUpserted: totalUpserted,
    fromDay: startDate,
    toDay: endDate,
  };
}
