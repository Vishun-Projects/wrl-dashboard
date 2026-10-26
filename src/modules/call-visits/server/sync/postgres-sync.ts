import { postQuery } from '@/lib/db/proxy';
import { withClient, withTransaction } from '@/lib/read-model/db';
import { buildCallPartsCrmSql } from '@/sql/call-visits/crm-fetch';

export const CALL_PARTS_ENTITY = 'call_parts';
const CHUNK_TOP = 2000;
const OVERLAP_MS = 5 * 60 * 1000;
const MAX_LOOPS = 100_000;

export type CallPartSyncRow = {
  ncode: string;
  nofficeid: string;
  ncalls: string;
  callNo: string | null;
  visitNo: string | null;
  visitAt: string | null;
  partCode: string | null;
  partName: string | null;
  qty: string | null;
  oldBarcode: string | null;
  newBarcode: string | null;
  remarks: string | null;
  claimed: string | null;
  editedon: Date | null;
  editedonKey: string | null;
  officeUnder: string | null;
};

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function officeId(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d+\.0+$/.test(s)) return s.slice(0, s.indexOf('.'));
  return s;
}

function dateOnly(v: unknown): string | null {
  const s = str(v);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

function parseCrmDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapCrmRow(row: Record<string, unknown>): CallPartSyncRow | null {
  const ncode = officeId(row.ncode);
  const nofficeid = officeId(row.nofficeid);
  const ncalls = officeId(row.ncalls);
  if (!ncode || !nofficeid || !ncalls) return null;
  const editedonKey = str(row.editedon);
  return {
    ncode,
    nofficeid,
    ncalls,
    callNo: str(row.call_no),
    visitNo: str(row.visit_no),
    visitAt: dateOnly(row.visit_at),
    partCode: str(row.part_code),
    partName: str(row.part_name),
    qty: str(row.qty),
    oldBarcode: str(row.old_barcode),
    newBarcode: str(row.new_barcode),
    remarks: str(row.remarks),
    claimed: str(row.claimed),
    editedon: parseCrmDate(row.editedon),
    editedonKey,
    officeUnder: officeId(row.office_under),
  };
}

type Pg = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

export async function ensureCallPartsTable(client: Pg): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS call_visits`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS call_parts (
      ncode TEXT NOT NULL,
      nofficeid TEXT NOT NULL,
      ncalls TEXT NOT NULL,
      call_no TEXT,
      visit_no TEXT,
      visit_at DATE,
      part_code TEXT,
      part_name TEXT,
      qty TEXT,
      old_barcode TEXT,
      new_barcode TEXT,
      remarks TEXT,
      claimed TEXT,
      editedon TIMESTAMPTZ,
      office_under TEXT,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ncode, nofficeid)
    );

    CREATE INDEX IF NOT EXISTS idx_call_parts_call_no ON call_parts (call_no);
    CREATE INDEX IF NOT EXISTS idx_call_parts_office ON call_parts (nofficeid);
    CREATE INDEX IF NOT EXISTS idx_call_parts_editedon ON call_parts (editedon);
    CREATE INDEX IF NOT EXISTS idx_call_parts_part_name
      ON call_parts (upper(btrim(part_name)))
      WHERE coalesce(btrim(part_name), '') <> '';

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'call_parts' AND column_name = 'visit_at'
      ) THEN
        ALTER TABLE call_parts ADD COLUMN visit_at DATE;
      END IF;
    END $$;

    INSERT INTO sync_state (entity, last_editedon, status)
    VALUES ('${CALL_PARTS_ENTITY}', NULL, 'ok')
    ON CONFLICT (entity) DO NOTHING;
  `);
}

const UPSERT_COLS = 15;

async function upsertRows(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  rows: CallPartSyncRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const byKey = new Map<string, CallPartSyncRow>();
  for (const row of rows) byKey.set(`${row.ncode}|${row.nofficeid}`, row);
  const unique = [...byKey.values()];
  const batchSize = 200;
  for (let i = 0; i < unique.length; i += batchSize) {
    const chunk = unique.slice(i, i + batchSize);
    const params: unknown[] = [];
    const valuesSql = chunk
      .map((r, idx) => {
        const base = idx * UPSERT_COLS;
        params.push(
          r.ncode,
          r.nofficeid,
          r.ncalls,
          r.callNo,
          r.visitNo,
          r.visitAt,
          r.partCode,
          r.partName,
          r.qty,
          r.oldBarcode,
          r.newBarcode,
          r.remarks,
          r.claimed,
          r.editedon,
          r.officeUnder
        );
        const slots = Array.from({ length: UPSERT_COLS }, (_, j) => `$${base + j + 1}`);
        return `(${slots.join(',')}, now())`;
      })
      .join(',\n');

    await client.query(
      `
      INSERT INTO call_parts (
        ncode, nofficeid, ncalls, call_no, visit_no, visit_at, part_code, part_name, qty,
        old_barcode, new_barcode, remarks, claimed, editedon, office_under, synced_at
      ) VALUES ${valuesSql}
      ON CONFLICT (ncode, nofficeid) DO UPDATE SET
        ncalls = EXCLUDED.ncalls,
        call_no = EXCLUDED.call_no,
        visit_no = EXCLUDED.visit_no,
        visit_at = EXCLUDED.visit_at,
        part_code = EXCLUDED.part_code,
        part_name = EXCLUDED.part_name,
        qty = EXCLUDED.qty,
        old_barcode = EXCLUDED.old_barcode,
        new_barcode = EXCLUDED.new_barcode,
        remarks = EXCLUDED.remarks,
        claimed = EXCLUDED.claimed,
        editedon = EXCLUDED.editedon,
        office_under = EXCLUDED.office_under,
        synced_at = now()
      `,
      params
    );
  }
  return unique.length;
}

async function checkpoint(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  editedon: Date | null,
  rows: number
): Promise<void> {
  const stored = rows > 2_000_000_000 ? 2_000_000_000 : rows;
  await client.query(
    `
    INSERT INTO sync_state (entity, last_editedon, last_run_at, status, rows_upserted_last)
    VALUES ($1, $2, now(), 'ok', $3)
    ON CONFLICT (entity) DO UPDATE SET
      last_editedon = COALESCE(EXCLUDED.last_editedon, sync_state.last_editedon),
      last_run_at = EXCLUDED.last_run_at,
      status = EXCLUDED.status,
      rows_upserted_last = EXCLUDED.rows_upserted_last
    `,
    [CALL_PARTS_ENTITY, editedon, stored]
  );
}

/**
 * Pages trdcalls3parts by (editedon, ncode). A killed run resumes from sync_state.
 * ponytail: 2000-row pages. If westerncrm.com returns 405/502, drop CHUNK_TOP to 500.
 * ponytail: only upserts. A part deleted in CRM stays until `--full`.
 */
export async function syncCallPartsToPostgres(opts?: {
  forceFull?: boolean;
  callFrom?: string;
  callTo?: string;
  /** Upsert the window without moving the resume cursor. */
  preserveWatermark?: boolean;
}): Promise<{ success: boolean; count: number; mode: string }> {
  const call =
    opts?.callFrom && opts.callTo ? { from: opts.callFrom, to: opts.callTo } : undefined;
  const lastWatermark = await withClient(async (client) => {
    await ensureCallPartsTable(client);
    if (opts?.forceFull || opts?.preserveWatermark) return null;
    const stateRes = await client.query<{ last_editedon: Date | null }>(
      `SELECT last_editedon FROM sync_state WHERE entity = $1`,
      [CALL_PARTS_ENTITY]
    );
    return stateRes.rows[0]?.last_editedon ? new Date(stateRes.rows[0].last_editedon) : null;
  });

  const mode = call ? 'month' : !lastWatermark || opts?.forceFull ? 'full' : 'incremental';
  let editedFrom: string | null = null;
  let afterNcode: string | null = null;
  if (mode === 'incremental' && lastWatermark) {
    editedFrom = new Date(lastWatermark.getTime() - OVERLAP_MS).toISOString().slice(0, 19);
  }

  let total = 0;
  let loops = 0;
  console.log(`[call-parts] Starting ${mode} sync…`);

  while (loops < MAX_LOOPS) {
    loops += 1;
    const res = await postQuery({
      rawSql: buildCallPartsCrmSql({
        editedFrom,
        afterNcode,
        callFrom: call?.from,
        callTo: call?.to,
        top: CHUNK_TOP,
      }),
      timeoutMs: 180_000,
    });
    const batch = ((res.data ?? []) as Record<string, unknown>[])
      .map(mapCrmRow)
      .filter((r): r is CallPartSyncRow => r != null);
    if (batch.length === 0) break;

    const last = batch[batch.length - 1]!;
    const stuck =
      Boolean(last.editedonKey) && editedFrom === last.editedonKey && afterNcode === last.ncode;

    await withTransaction(async (client) => {
      total += await upsertRows(client, batch);
      if (!opts?.preserveWatermark && last.editedon) await checkpoint(client, last.editedon, total);
    });

    if (!last.editedonKey) {
      console.log(`[call-parts] stopped: chunk ${loops} has no editedon key`);
      break;
    }
    if (stuck) {
      console.log(`[call-parts] stopped: keyset did not advance at ${editedFrom}/${afterNcode}`);
      break;
    }

    editedFrom = last.editedonKey;
    afterNcode = last.ncode;
    console.log(`[call-parts] ${mode} chunk ${loops}: total ${total}, after=${editedFrom}/${afterNcode}`);
    if (batch.length < CHUNK_TOP) break;
  }

  if (!opts?.preserveWatermark) {
    await withClient(async (client) => {
      await checkpoint(client, null, total);
    });
  }

  console.log(`[call-parts] Done ${mode}: ${total} rows`);
  return { success: true, count: total, mode };
}
