import type pg from 'pg';
import { withTransaction, withClient } from '@/lib/read-model/db';
import { TRANSACTION_ENTRY_ENTITY, monthChunks, weekChunks, yearChunks } from './shared';
import {
  fetchTransactionEntryClients,
  fetchTransactionEntryPeriod,
  fetchTransactionEntryClientPeriod,
} from './crm-fetch';
import {
  upsertTransactionEntryRows,
  replaceClientPeriodMirror,
  replacePeriodMirror,
} from './upsert';
import {
  mismatchedClients,
  verifyCallRegisterTransactionEntry,
} from './verify';

import { sleep } from '@/lib/utils/async';

/** Pause between backfill period fetches so we do not hammer CRM (default 1500ms). */
function backfillGapMs(): number {
  const n = Number(process.env.TRANSACTION_ENTRY_BACKFILL_GAP_MS ?? 1500);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1500;
}

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

async function applyClientPeriod(
  account: string,
  from: string,
  end: string
): Promise<{ upserted: number; deleted: number }> {
  const fetch = await fetchTransactionEntryClientPeriod(account, from, end);
  if (fetch.incomplete) {
    console.warn(
      `[transaction-entry] incomplete CRM fetch for ${account} ${from}..${end} — upsert only (no stale delete)`
    );
    const upserted = await withTransaction(async (c) =>
      upsertTransactionEntryRows(c, fetch.rows)
    );
    return { upserted, deleted: 0 };
  }
  return withTransaction(async (c) =>
    replaceClientPeriodMirror(c, account, from, end, fetch.rows)
  );
}

async function applyBulkPeriod(
  from: string,
  end: string,
  clients: string[]
): Promise<{ upserted: number; deleted: number }> {
  const fetch = await fetchTransactionEntryPeriod(from, end, clients);
  if (fetch.incomplete) {
    console.warn(
      `[transaction-entry] incomplete CRM fetch for ${from}..${end} — upsert only (no stale delete)`
    );
    const upserted = await withTransaction(async (c) =>
      upsertTransactionEntryRows(c, fetch.rows)
    );
    return { upserted, deleted: 0 };
  }
  return withTransaction(async (c) => replacePeriodMirror(c, from, end, fetch.rows));
}

/** Per-client CRM fetch + upsert for the given clients and date window (heal path). */
async function syncClientsPeriod(
  clients: readonly string[],
  from: string,
  end: string,
  label: string
): Promise<number> {
  let upserted = 0;
  let deleted = 0;
  for (const account of clients) {
    const result = await applyClientPeriod(account, from, end);
    upserted += result.upserted;
    deleted += result.deleted;
  }
  console.log(
    `[transaction-entry] ${label} ${from} → ${end} upserted ${upserted}, removed ${deleted} stale (${clients.length} clients)`
  );
  return upserted;
}

/** Recent window for all CRM clients (bulk period fetch with OOM split). */
async function syncAllClientsRecent(end: string, clients: string[]): Promise<number> {
  const from = subtractDays(end, recentDays());
  const result = await applyBulkPeriod(from, end, clients);
  console.log(
    `[transaction-entry] Recent sync ${from} → ${end} upserted ${result.upserted}, removed ${result.deleted} stale (${clients.length} clients)`
  );
  return result.upserted;
}

/**
 * Compare CRM vs mirror for all CRM clients; re-fetch any mismatch.
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
 * Full backfill: week-sized windows by default, one period at a time.
 * Default = one CRM query per week for all clients (fast). On CRM/Node OOM the
 * fetch layer splits the window and falls back to per-client.
 * Set TRANSACTION_ENTRY_BACKFILL_PER_CLIENT=true for always-per-client (slow, gentler).
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
  const chunkMode = process.env.TRANSACTION_ENTRY_BACKFILL_CHUNK?.trim() || 'week';
  const chunks =
    chunkMode === 'year'
      ? yearChunks(from, end)
      : chunkMode === 'month'
        ? monthChunks(from, end)
        : weekChunks(from, end);
  // Default 1 — never fan out months in parallel against CRM.
  const parallel = Math.max(1, Number(process.env.TRANSACTION_ENTRY_PERIOD_PARALLEL ?? 1) || 1);
  const gapMs = backfillGapMs();
  const perClient = process.env.TRANSACTION_ENTRY_BACKFILL_PER_CLIENT === 'true';
  const clientGapMs = (() => {
    const n = Number(process.env.TRANSACTION_ENTRY_CLIENT_GAP_MS ?? 400);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 400;
  })();
  console.log(
    `[transaction-entry] Backfill ${from} → ${end} (${chunkMode} chunks, ${chunks.length} periods, parallel ${parallel}, gap ${gapMs}ms, ${perClient ? `per-client gap ${clientGapMs}ms` : 'bulk-all-clients (OOM → split/per-client)'}, ${clients.length} CRM clients)`
  );

  let total = 0;

  try {
    for (let i = 0; i < chunks.length; i += parallel) {
      if (i > 0 && gapMs > 0) await sleep(gapMs);

      const batch = chunks.slice(i, i + parallel);

      for (const chunk of batch) {
        const t0 = Date.now();
        let upserted = 0;

        if (perClient) {
          let removed = 0;
          for (let ci = 0; ci < clients.length; ci++) {
            if (ci > 0 && clientGapMs > 0) await sleep(clientGapMs);
            const result = await applyClientPeriod(clients[ci], chunk.from, chunk.to);
            upserted += result.upserted;
            removed += result.deleted;
          }
          if (removed > 0) {
            console.log(
              `[transaction-entry] Period ${chunk.from}..${chunk.to} removed ${removed} stale (unprocessed) rows`
            );
          }
        } else {
          const result = await applyBulkPeriod(chunk.from, chunk.to, clients);
          upserted = result.upserted;
          if (result.deleted > 0) {
            console.log(
              `[transaction-entry] Period ${chunk.from}..${chunk.to} removed ${result.deleted} stale (unprocessed) rows`
            );
          }
        }

        total += upserted;
        const sec = Math.round((Date.now() - t0) / 1000);
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

/** Incremental: re-sync last OVERLAP_MONTHS (or full history when `full`). */
export async function runTransactionEntryIncremental(opts?: {
  /** From TRANSACTION_ENTRY_START_DATE → today, week chunks + replace (purge unprocessed orphans). */
  full?: boolean;
}): Promise<{
  skipped?: boolean;
  reason?: string;
  rowsUpserted: number;
}> {
  if (process.env.SYNC_TRANSACTION_ENTRY_ENABLED === 'false') {
    return { skipped: true, reason: 'SYNC_TRANSACTION_ENTRY_ENABLED=false', rowsUpserted: 0 };
  }

  const full =
    opts?.full === true || process.env.TRANSACTION_ENTRY_FULL === 'true';
  const end = todayUtc();
  let from = full ? startDate() : subtractMonths(end, overlapMonths());

  const state = await withClient(async (client) => readWatermark(client));
  if (state.status === 'pending_backfill') {
    return {
      skipped: true,
      reason: 'pending_backfill — run: npm run sync-worker:transaction-entry-backfill',
      rowsUpserted: 0,
    };
  }

  if (from < startDate()) from = startDate();

  console.log(
    `[transaction-entry] ${full ? 'Full scrub' : 'Incremental'} ${from} → ${end}`
  );

  try {
    await withClient(async (client) => markRunning(client));

    const clients = await fetchTransactionEntryClients();
    let upserted = 0;
    let removed = 0;

    if (full) {
      // Week-by-week replace so unprocessed orphans drop for the whole mirror.
      const chunks = weekChunks(from, end);
      const gapMs = backfillGapMs();
      const clientGapMs = (() => {
        const n = Number(process.env.TRANSACTION_ENTRY_CLIENT_GAP_MS ?? 200);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200;
      })();
      console.log(
        `[transaction-entry] Full scrub ${chunks.length} weeks, gap ${gapMs}ms, ${clients.length} clients (per-client gap ${clientGapMs}ms)`
      );
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0 && gapMs > 0) await sleep(gapMs);
        const chunk = chunks[i]!;
        const t0 = Date.now();
        let weekUpserted = 0;
        let weekRemoved = 0;
        for (let ci = 0; ci < clients.length; ci++) {
          if (ci > 0 && clientGapMs > 0) await sleep(clientGapMs);
          const result = await applyClientPeriod(clients[ci]!, chunk.from, chunk.to);
          weekUpserted += result.upserted;
          weekRemoved += result.deleted;
        }
        upserted += weekUpserted;
        removed += weekRemoved;
        const sec = Math.round((Date.now() - t0) / 1000);
        console.log(
          `[transaction-entry] Scrub ${chunk.from}..${chunk.to} upserted ${weekUpserted}, removed ${weekRemoved} in ${sec}s (total upserted ${upserted}, removed ${removed})`
        );
        await withClient(async (client) => {
          await markOk(client, new Date(`${chunk.to}T23:59:59Z`), upserted);
        });
      }
    } else {
      upserted = await syncAllClientsRecent(end, clients);

      for (const chunk of monthChunks(from, end)) {
        const result = await applyBulkPeriod(chunk.from, chunk.to, clients);
        upserted += result.upserted;
        removed += result.deleted;
      }
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

    console.log(
      `[transaction-entry] ${full ? 'Full scrub' : 'Incremental'} complete — upserted ${upserted}, removed ${removed} stale`
    );
    return { rowsUpserted: upserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withClient(async (client) => markError(client, message));
    throw err;
  }
}
