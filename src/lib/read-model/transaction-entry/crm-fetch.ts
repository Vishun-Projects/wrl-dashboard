import { postQuery, isCrmOutOfMemoryError } from '@/lib/db/proxy';
import { parseCrmDaddedon, periodDays, TRANSACTION_ENTRY_PROCESSED_SQL } from './shared';

/** Gap between CRM calls when chunking after OOM / between slices (default 1000ms). */
const FETCH_GAP_MS = Number(process.env.TRANSACTION_ENTRY_FETCH_GAP_MS ?? 1000) || 1000;

/** Per-client parallel fallback when a week slice still OOMs (default 1 — be kind to CRM). */
const CLIENT_PARALLEL = Number(process.env.TRANSACTION_ENTRY_CLIENT_PARALLEL ?? 1) || 1;

const CRM_TIMEOUT_MS = Number(process.env.TRANSACTION_ENTRY_CRM_TIMEOUT_MS ?? 180_000) || 180_000;

export type CrmTransactionEntryRow = {
  client: string;
  productSerialNo: string;
  daddedonRaw: string;
  daddedon: Date | null;
  /** CRM WarrantyStartDate — Call Register billing date */
  warrantyStartRaw: string;
  warrantyStart: Date | null;
  uniqueId: string | null;
};

/** incomplete=true when a CRM OOM slice was skipped — do not mirror-delete for that window. */
export type CrmTransactionEntryFetch = {
  rows: CrmTransactionEntryRow[];
  incomplete: boolean;
};

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSelect(client: string | null, dateFrom: string, dateTo: string): string {
  const clientFilter = client ? `AND Client = ${sqlLiteral(client)}` : '';
  // Sync window uses daddedon (upload time). Billing date is WarrantyStartDate (stored separately).
  return `
    SELECT
      Client AS Client,
      ProductSerialNo AS ProductSerialNo,
      daddedon AS daddedon,
      WarrantyStartDate AS WarrantyStartDate,
      UNIQUEID AS UNIQUEID
    FROM TransactionEntry
    WHERE ProductSerialNo IS NOT NULL
      AND ProductSerialNo <> ''
      AND Client IS NOT NULL
      AND LTRIM(RTRIM(Client)) <> ''
      AND ${TRANSACTION_ENTRY_PROCESSED_SQL}
      ${clientFilter}
      AND TRY_CONVERT(DATETIME, daddedon, 103) >= TRY_CONVERT(DATETIME, '${dateFrom}', 120)
      AND TRY_CONVERT(DATETIME, daddedon, 103) <= TRY_CONVERT(DATETIME, '${dateTo} 23:59:59', 120)
  `;
}

function appendRows(target: CrmTransactionEntryRow[], rows: CrmTransactionEntryRow[]): void {
  // ponytail: push(...rows) overflows call stack past ~100k CRM rows; chunk spread instead
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    target.push(...rows.slice(i, i + CHUNK));
  }
}

function mapRows(raw: Record<string, string>[]): CrmTransactionEntryRow[] {
  const out: CrmTransactionEntryRow[] = [];
  for (const row of raw) {
    const client = String(row.Client ?? '').trim();
    const productSerialNo = String(row.ProductSerialNo ?? '').trim();
    if (!client || !productSerialNo) continue;
    const daddedonRaw = String(row.daddedon ?? '').trim();
    const warrantyStartRaw = String(row.WarrantyStartDate ?? '').trim();
    out.push({
      client,
      productSerialNo,
      daddedonRaw,
      daddedon: parseCrmDaddedon(daddedonRaw),
      warrantyStartRaw,
      warrantyStart: parseCrmDaddedon(warrantyStartRaw),
      uniqueId: String(row.UNIQUEID ?? '').trim() || null,
    });
  }
  return out;
}


async function fetchOnce(
  client: string | null,
  dateFrom: string,
  dateTo: string
): Promise<CrmTransactionEntryRow[]> {
  const result = await postQuery({
    rawSql: buildSelect(client, dateFrom, dateTo),
    timeoutMs: CRM_TIMEOUT_MS,
  });
  return mapRows((result.data || []) as Record<string, string>[]);
}

function splitPeriod(dateFrom: string, dateTo: string): [{ from: string; to: string }, { from: string; to: string }] | null {
  if (periodDays(dateFrom, dateTo) <= 1) return null;
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  const mid = new Date(start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2));
  const leftTo = mid.toISOString().slice(0, 10);
  const rightFrom = new Date(mid);
  rightFrom.setUTCDate(rightFrom.getUTCDate() + 1);
  const rightFromStr = rightFrom.toISOString().slice(0, 10);
  if (rightFromStr > dateTo) return null;
  const left = { from: dateFrom, to: leftTo };
  const right = { from: rightFromStr, to: dateTo };
  if (left.from === left.to && right.from === right.to && left.from === right.from) return null;
  return [left, right];
}

/** Iterative OOM split — avoids deep recursion stack overflow on large months. */
async function fetchClientPeriod(
  client: string,
  dateFrom: string,
  dateTo: string
): Promise<CrmTransactionEntryFetch> {
  const pending: { from: string; to: string }[] = [{ from: dateFrom, to: dateTo }];
  const all: CrmTransactionEntryRow[] = [];
  let incomplete = false;

  while (pending.length > 0) {
    const { from, to } = pending.pop()!;
    try {
      appendRows(all, await fetchOnce(client, from, to));
      continue;
    } catch (err) {
      if (!isCrmOutOfMemoryError(err)) throw err;
    }

    if (periodDays(from, to) <= 1) {
      console.warn(`[transaction-entry] CRM OOM for ${client} on ${from}, skipping slice`);
      incomplete = true;
      continue;
    }

    const split = splitPeriod(from, to);
    if (!split) {
      console.warn(`[transaction-entry] CRM OOM for ${client} on ${from}..${to}, skipping slice`);
      incomplete = true;
      continue;
    }
    pending.push(split[1], split[0]);
    await sleep(FETCH_GAP_MS);
  }

  return { rows: all, incomplete };
}

/** Per-client fetch for Deployment Completion accounts (exported for incremental recent window). */
export function fetchTransactionEntryClientPeriod(
  client: string,
  dateFrom: string,
  dateTo: string
): Promise<CrmTransactionEntryFetch> {
  return fetchClientPeriod(client, dateFrom, dateTo);
}

async function fetchClientsParallel(
  clients: string[],
  dateFrom: string,
  dateTo: string
): Promise<CrmTransactionEntryFetch> {
  const all: CrmTransactionEntryRow[] = [];
  let incomplete = false;
  for (let i = 0; i < clients.length; i += CLIENT_PARALLEL) {
    const batch = clients.slice(i, i + CLIENT_PARALLEL);
    const parts = await Promise.all(
      batch.map((client) => fetchClientPeriod(client, dateFrom, dateTo))
    );
    for (const part of parts) {
      appendRows(all, part.rows);
      if (part.incomplete) incomplete = true;
    }
  }
  return { rows: all, incomplete };
}

async function fetchPeriodSplit(
  dateFrom: string,
  dateTo: string,
  clientsForFallback: string[]
): Promise<CrmTransactionEntryFetch> {
  const pending: { from: string; to: string }[] = [{ from: dateFrom, to: dateTo }];
  const all: CrmTransactionEntryRow[] = [];
  let incomplete = false;

  while (pending.length > 0) {
    const { from, to } = pending.pop()!;
    try {
      appendRows(all, await fetchOnce(null, from, to));
      continue;
    } catch (err) {
      if (!isCrmOutOfMemoryError(err)) throw err;
    }

    const days = periodDays(from, to);
    if (days <= 7) {
      const part = await fetchClientsParallel(clientsForFallback, from, to);
      appendRows(all, part.rows);
      if (part.incomplete) incomplete = true;
      continue;
    }

    const split = splitPeriod(from, to);
    if (!split) {
      const part = await fetchClientsParallel(clientsForFallback, from, to);
      appendRows(all, part.rows);
      if (part.incomplete) incomplete = true;
      continue;
    }
    pending.push(split[1], split[0]);
    await sleep(FETCH_GAP_MS);
  }

  return { rows: all, incomplete };
}

/**
 * Fetch one date window for all clients (1 CRM query when it fits).
 * OOM → binary split down to 7-day slices, then parallel per-client.
 */
export async function fetchTransactionEntryPeriod(
  dateFrom: string,
  dateTo: string,
  clientsForFallback?: string[]
): Promise<CrmTransactionEntryFetch> {
  const clients = clientsForFallback ?? (await fetchTransactionEntryClients());
  return fetchPeriodSplit(dateFrom, dateTo, clients);
}

/** Distinct Client values in CRM TransactionEntry. */
export async function fetchTransactionEntryClients(): Promise<string[]> {
  const result = await postQuery({
    rawSql: `
      SELECT DISTINCT LTRIM(RTRIM(Client)) AS Client
      FROM TransactionEntry
      WHERE ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
        AND Client IS NOT NULL AND LTRIM(RTRIM(Client)) <> ''
        AND ${TRANSACTION_ENTRY_PROCESSED_SQL}
      ORDER BY Client
    `,
    timeoutMs: CRM_TIMEOUT_MS,
  });
  const clients = ((result.data || []) as Record<string, string>[])
    .map((r) => String(r.Client ?? '').trim())
    .filter(Boolean);
  return [...new Set(clients)].sort((a, b) => a.localeCompare(b));
}
