import type pg from 'pg';
import { withClient } from '@/lib/read-model/db';
import { formatLocalDate } from '@/lib/dates/local-date';
import { todayLocalDate } from '@/lib/read-model/dates';
import { CANCELLED_CALL_REGISTER_ENTITY } from './constants';
import { syncCancelledRegisterFromPostgres } from './postgres-sync';

export type CancelledCallRegisterSyncResult = {
  ok: boolean;
  source: 'mirror' | 'hot';
  dateFrom: string;
  dateTo: string;
  upserted: number;
  deleted: number;
};

function defaultStart(): string {
  return (
    process.env.CANCELLED_REGISTER_START_DATE?.trim() ||
    `${new Date().getFullYear()}-01-01`
  );
}

async function readWatermark(): Promise<Date | null> {
  return withClient(async (client) => {
    const res = await client.query<{ last_editedon: Date | null }>(
      `SELECT last_editedon FROM sync_state WHERE entity = $1`,
      [CANCELLED_CALL_REGISTER_ENTITY]
    );
    return res.rows[0]?.last_editedon ?? null;
  });
}

async function markOk(watermark: Date, rowsUpserted: number): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO sync_state (entity, last_editedon, last_addedon, status, is_running, last_run_at, rows_upserted_last)
       VALUES ($1, $2, $2, 'ok', false, now(), $3)
       ON CONFLICT (entity) DO UPDATE SET
         status = 'ok',
         is_running = false,
         last_run_at = now(),
         last_editedon = GREATEST(COALESCE(sync_state.last_editedon, '-infinity'::timestamptz), EXCLUDED.last_editedon),
         rows_upserted_last = EXCLUDED.rows_upserted_last`,
      [CANCELLED_CALL_REGISTER_ENTITY, watermark, rowsUpserted]
    );
  });
}

function resolveSince(opts?: { dateFrom?: string; full?: boolean }): Date | null {
  if (opts?.full) return null;
  if (opts?.dateFrom) return new Date(`${opts.dateFrom}T00:00:00`);
  return null;
}

/** Postgres → calls_cancelled for /report/cancelled-calls (no CRM rpt_cancelcallregister pull). */
export async function runCancelledCallRegisterSync(opts?: {
  dateFrom?: string;
  dateTo?: string;
  full?: boolean;
}): Promise<CancelledCallRegisterSyncResult> {
  const dateTo = opts?.dateTo ?? todayLocalDate();
  let dateFrom = opts?.dateFrom;
  let since: Date | null = resolveSince(opts);

  if (!dateFrom) {
    const watermark = await readWatermark();
    if (opts?.full || !watermark || watermark.getTime() <= Date.parse('1971-01-01')) {
      dateFrom = defaultStart();
      since = opts?.full ? null : new Date(`${dateFrom}T00:00:00`);
    } else {
      const overlap = new Date(watermark);
      overlap.setDate(overlap.getDate() - 2);
      dateFrom = formatLocalDate(overlap);
      since = overlap;
    }
  } else if (!since) {
    since = new Date(`${dateFrom}T00:00:00`);
  }

  const result = await withClient(async (client: pg.PoolClient) => {
    const written = await syncCancelledRegisterFromPostgres(client, since);
    const maxRes = await client.query<{ max_cancelled_at: Date | null }>(
      `SELECT max(cancelled_at) AS max_cancelled_at FROM calls_cancelled`
    );
    return { ...written, maxCancelledAt: maxRes.rows[0]?.max_cancelled_at ?? null };
  });

  console.log(
    `[cancelled-register] ${result.source} → calls_cancelled: upserted ${result.upserted}, deleted ${result.deleted} (since ${since?.toISOString() ?? 'all'})`
  );

  const watermark = result.maxCancelledAt ?? since ?? new Date(`${dateTo}T23:59:59`);
  await markOk(watermark, result.upserted);

  return {
    ok: true,
    source: result.source,
    dateFrom,
    dateTo,
    upserted: result.upserted,
    deleted: result.deleted,
  };
}
