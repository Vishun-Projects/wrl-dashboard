import type pg from 'pg';
import { withTransaction, withClient } from '@/lib/read-model/db';
import { CALL_REGISTER_CLIENTS } from '@/lib/report/call-register/clients';
import { TRANSACTION_ENTRY_ENTITY, monthChunks, yearChunks } from './shared';
import {
  fetchTransactionEntryClients,
  fetchTransactionEntryPeriod,
  fetchTransactionEntryClientPeriod,
} from './crm-fetch';
import { upsertTransactionEntryRows } from './upsert';
import {
  mismatchedClients,
  verifyCallRegisterTransactionEntry,
} from './verify';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function startDate(): string {
  return process.env.TRANSACTION_ENTRY_START_DATE?.trim() || '2024-01-01';
}

function overlapMonths(): number {
  const n = Number(process.env.TRANSACTION_ENTRY_OVERLAP_MONTHS ?? 2);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}

async function readWatermark(client: pg.PoolClient): Promise<{
  status: string;
  lastAddedon: Date | null;
}> {
  const res = await client.query<{ status: string; last_addedon: Date | null }>(
    `SELECT status, last_addedon FROM sync_state WHERE entity = $1`,
    [TRANSACTION_ENTRY_ENTITY]
  );
  const row = res.rows[0];
  return {
    status: row?.status ?? 'pending_backfill',
    lastAddedon: row?.last_addedon ?? null,
  };
}

async function markRunning(client: pg.PoolClient): Promise<void> {
  await client.query(
    `UPDATE sync_state
     SET is_running = true, status = CASE WHEN status = 'ok' THEN status ELSE 'backfilling' END
     WHERE entity = $1`,
    [TRANSACTION_ENTRY_ENTITY]
  );
}

async function markOk(client: pg.PoolClient, watermark: Date, rowsUpserted: number): Promise<void> {
  await client.query(
    `UPDATE sync_state
     SET status = 'ok',
         is_running = false,
         last_run_at = now(),
         last_addedon = $2,
         rows_upserted_last = $3
     WHERE entity = $1`,
    [TRANSACTION_ENTRY_ENTITY, watermark, rowsUpserted]
  );
}

async function markError(client: pg.PoolClient, message: string): Promise<void> {
  await client.query(
    `UPDATE sync_state
     SET status = 'error', is_running = false, last_run_at = now()
     WHERE entity = $1`,
    [TRANSACTION_ENTRY_ENTITY]
  );
  console.error('[transaction-entry] sync error:', message.slice(0, 500));
}

function subtractMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function recentDays(): number {
  const n = Number(process.env.TRANSACTION_ENTRY_RECENT_DAYS ?? 14);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
}

function verifyDays(): number {
  const n = Number(process.env.TRANSACTION_ENTRY_VERIFY_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
}

/** Per-client CRM fetch + upsert for the given clients and date window. */
async function syncClientsPeriod(
  clients: readonly string[],
  from: string,
  end: string,
  label: string
): Promise<number> {
  let upserted = 0;
  for (const client of clients) {
    const rows = await fetchTransactionEntryClientPeriod(client, from, end);
    upserted += await withTransaction(async (c) => upsertTransactionEntryRows(c, rows));
  }
  console.log(`[transaction-entry] ${label} ${from} → ${end} upserted ${upserted} (${clients.length} clients)`);
  return upserted;
}

/** Deployment Completion accounts — per-client CRM fetch for recent uploads. */
async function syncCallRegisterClientsRecent(end: string): Promise<number> {
  const from = subtractDays(end, recentDays());
  return syncClientsPeriod(CALL_REGISTER_CLIENTS, from, end, 'Call-register recent sync');
}

/**
 * Compare CRM vs mirror for Deployment Completion accounts; re-fetch any mismatch.
 * Returns extra rows upserted while healing.
 */
export async function healCallRegisterMismatches(end: string): Promise<number> {
  if (process.env.TRANSACTION_ENTRY_VERIFY_ENABLED === 'false') return 0;

  const verifyTo = end;
  const verifyFrom = subtractDays(verifyTo, verifyDays());
  const before = await verifyCallRegisterTransactionEntry({
    dateFrom: verifyFrom,
    dateTo: verifyTo,
  });
  const bad = mismatchedClients(before);
  if (!bad.length) {
    console.log(
      `[transaction-entry] verify ${verifyFrom}..${verifyTo} — all ${before.length} clients in sync`
    );
    return 0;
  }

  console.log(
    `[transaction-entry] healing ${bad.length} mismatch(es): ${bad.join(', ')} (${verifyFrom}..${verifyTo})`
  );
  const healed = await syncClientsPeriod(bad, verifyFrom, verifyTo, 'heal mismatch');

  const after = await verifyCallRegisterTransactionEntry({
    dateFrom: verifyFrom,
    dateTo: verifyTo,
  });
  const stillBad = mismatchedClients(after);
  if (stillBad.length) {
    console.warn(
      `[transaction-entry] still mismatched after heal: ${stillBad.join(', ')} — check CRM ERROR/null daddedon`
    );
  } else {
    console.log(`[transaction-entry] heal complete — all clients in sync`);
  }
  return healed;
}

/**
 * Full backfill: one CRM query per calendar month (all clients), OOM → week → parallel client.
 */
export async function runTransactionEntryBackfill(): Promise<{ rowsUpserted: number }> {
  const end = todayUtc();
  let from = startDate();
  const resume = process.env.TRANSACTION_ENTRY_RESUME === 'true';

  await withClient(async (client) => {
    if (resume) {
      const state = await readWatermark(client);
      if (state.lastAddedon) {
        from = subtractMonths(state.lastAddedon.toISOString().slice(0, 10), overlapMonths());
        if (from < startDate()) from = startDate();
      }
    }
    await markRunning(client);
  });

  const clients = await fetchTransactionEntryClients();
  const chunkMode = process.env.TRANSACTION_ENTRY_BACKFILL_CHUNK?.trim() || 'month';
  const chunks =
    chunkMode === 'year' ? yearChunks(from, end) : monthChunks(from, end);
  const parallel = Number(process.env.TRANSACTION_ENTRY_PERIOD_PARALLEL ?? 3) || 3;
  console.log(
    `[transaction-entry] Backfill ${from} → ${end} (${chunkMode} chunks, ${chunks.length} periods, parallel ${parallel}, ${clients.length} CRM clients)`
  );

  let total = 0;

  try {
    for (let i = 0; i < chunks.length; i += parallel) {
      const batch = chunks.slice(i, i + parallel);
      const fetched = await Promise.all(
        batch.map(async (chunk) => {
          const t0 = Date.now();
          const rows = await fetchTransactionEntryPeriod(chunk.from, chunk.to, clients);
          return { chunk, rows, fetchSec: Math.round((Date.now() - t0) / 1000) };
        })
      );

      for (const { chunk, rows, fetchSec } of fetched) {
        const t0 = Date.now();
        const upserted = await withTransaction(async (client) =>
          upsertTransactionEntryRows(client, rows)
        );
        total += upserted;
        const sec = fetchSec + Math.round((Date.now() - t0) / 1000);
        console.log(
          `[transaction-entry] Period ${chunk.from}..${chunk.to} upserted ${upserted} in ${sec}s (total ${total})`
        );
      }

      const lastChunk = batch[batch.length - 1];
      await withClient(async (client) => {
        await markOk(client, new Date(`${lastChunk.to}T23:59:59Z`), total);
      });
    }

    console.log(`[transaction-entry] Backfill complete — upserted ${total}`);
    return { rowsUpserted: total };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withClient(async (client) => markError(client, message));
    throw err;
  }
}

/** Incremental: re-sync last OVERLAP_MONTHS through today (bulk month fetch). */
export async function runTransactionEntryIncremental(): Promise<{
  skipped?: boolean;
  reason?: string;
  rowsUpserted: number;
}> {
  if (process.env.SYNC_TRANSACTION_ENTRY_ENABLED === 'false') {
    return { skipped: true, reason: 'SYNC_TRANSACTION_ENTRY_ENABLED=false', rowsUpserted: 0 };
  }

  const end = todayUtc();
  let from = subtractMonths(end, overlapMonths());

  const state = await withClient(async (client) => readWatermark(client));
  if (state.status === 'pending_backfill') {
    return {
      skipped: true,
      reason: 'pending_backfill — run: npm run sync-worker:transaction-entry-backfill',
      rowsUpserted: 0,
    };
  }

  if (from < startDate()) from = startDate();

  console.log(`[transaction-entry] Incremental ${from} → ${end}`);

  try {
    await withClient(async (client) => markRunning(client));

    let upserted = await syncCallRegisterClientsRecent(end);

    const clients = await fetchTransactionEntryClients();
    for (const chunk of monthChunks(from, end)) {
      const rows = await fetchTransactionEntryPeriod(chunk.from, chunk.to, clients);
      upserted += await withTransaction(async (client) => upsertTransactionEntryRows(client, rows));
    }

    try {
      upserted += await healCallRegisterMismatches(end);
    } catch (healErr) {
      console.warn(
        '[transaction-entry] heal failed (incremental succeeded):',
        healErr instanceof Error ? healErr.message : healErr
      );
    }

    await withClient(async (client) => {
      await markOk(client, new Date(`${end}T23:59:59Z`), upserted);
    });

    console.log(`[transaction-entry] Incremental complete — upserted ${upserted}`);
    return { rowsUpserted: upserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withClient(async (client) => markError(client, message));
    throw err;
  }
}
