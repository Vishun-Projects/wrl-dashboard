import { postQuery } from '@/lib/db/proxy';
import { truthyCrmFlag } from '@/lib/call/status/register-row';
import { withClient } from '@/lib/read-model/db';
import { buildDefectiveSerialsCrmSql } from '@/sql/defective-serials/crm-fetch';

const ENTITY = 'defective_serials';
const CHUNK_TOP = 500;
/** Overlap when reading incremental editedon windows. */
const OVERLAP_MS = 5 * 60 * 1000;

export type DefectiveSerialSyncRow = {
  ncode: string;
  ncalls: string;
  nitem: string | null;
  vserialno: string | null;
  nitemserialno: string | null;
  noldnitem: string | null;
  voldserialno: string | null;
  nnewnitem: string | null;
  vnewserialno: string | null;
  nofficeid: string;
  editedon: Date | null;
  /** CRM CONVERT(126) string — used for keyset paging (avoid TZ drift). */
  editedonKey: string | null;
  breturntobranch: boolean;
  dreturntobranchdate: Date | null;
  nreturntobranch: string | null;
  return_by_name: string | null;
  vtrnno: string | null;
  dtrndate: Date | null;
  party_name: string | null;
  client_name: string | null;
  model: string | null;
  machine_serial: string | null;
  city: string | null;
  call_centre_call_id: string | null;
  branch_name: string | null;
  defective_item_code: string | null;
  defective_item_name: string | null;
};

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function parseCrmDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapCrmRow(row: Record<string, unknown>): DefectiveSerialSyncRow | null {
  const ncode = str(row.ncode);
  const ncalls = str(row.ncalls);
  const nofficeid = str(row.nofficeid);
  if (!ncode || !ncalls || !nofficeid) return null;
  const editedonKey = str(row.editedon);
  return {
    ncode,
    ncalls,
    nitem: str(row.nitem),
    vserialno: str(row.vserialno),
    nitemserialno: str(row.nitemserialno),
    noldnitem: str(row.noldnitem),
    voldserialno: str(row.voldserialno),
    nnewnitem: str(row.nnewnitem),
    vnewserialno: str(row.vnewserialno),
    nofficeid,
    editedon: parseCrmDate(row.editedon),
    editedonKey,
    breturntobranch: truthyCrmFlag(row.breturntobranch),
    dreturntobranchdate: parseCrmDate(row.dreturntobranchdate),
    nreturntobranch: str(row.nreturntobranch),
    return_by_name: str(row.return_by_name),
    vtrnno: str(row.vtrnno),
    dtrndate: parseCrmDate(row.dtrndate),
    party_name: str(row.party_name),
    client_name: str(row.client_name),
    model: str(row.model),
    machine_serial: str(row.machine_serial),
    city: str(row.city),
    call_centre_call_id: str(row.call_centre_call_id),
    branch_name: str(row.branch_name),
    defective_item_code: str(row.defective_item_code),
    defective_item_name: str(row.defective_item_name),
  };
}

async function ensureDefectiveSerialsTable(client: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS defective_serials (
      ncode TEXT NOT NULL,
      nofficeid TEXT NOT NULL,
      ncalls TEXT NOT NULL,
      nitem TEXT,
      vserialno TEXT,
      nitemserialno TEXT,
      noldnitem TEXT,
      voldserialno TEXT,
      nnewnitem TEXT,
      vnewserialno TEXT,
      editedon TIMESTAMPTZ,
      breturntobranch BOOLEAN NOT NULL DEFAULT false,
      dreturntobranchdate TIMESTAMPTZ,
      nreturntobranch TEXT,
      return_by_name TEXT,
      vtrnno TEXT,
      dtrndate TIMESTAMPTZ,
      party_name TEXT,
      client_name TEXT,
      model TEXT,
      machine_serial TEXT,
      city TEXT,
      call_centre_call_id TEXT,
      branch_name TEXT,
      defective_item_code TEXT,
      defective_item_name TEXT,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ncode, nofficeid)
    );

    CREATE INDEX IF NOT EXISTS idx_defective_serials_editedon
      ON defective_serials (editedon);
    CREATE INDEX IF NOT EXISTS idx_defective_serials_breturn
      ON defective_serials (breturntobranch);
    CREATE INDEX IF NOT EXISTS idx_defective_serials_dtrndate
      ON defective_serials (dtrndate);
    CREATE INDEX IF NOT EXISTS idx_defective_serials_vtrnno
      ON defective_serials (vtrnno);
    CREATE INDEX IF NOT EXISTS idx_defective_serials_composite
      ON defective_serials (ncalls, nitem, vserialno, nitemserialno, nofficeid);

    ALTER TABLE defective_serials ADD COLUMN IF NOT EXISTS return_by_name TEXT;

    INSERT INTO sync_state (entity, last_editedon, status)
    VALUES ('${ENTITY}', NULL, 'ok')
    ON CONFLICT (entity) DO NOTHING;
  `);
}

const UPSERT_COLS = 26;

async function upsertRows(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  rows: DefectiveSerialSyncRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const batchSize = 40;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const params: unknown[] = [];
    const valuesSql = chunk
      .map((r, idx) => {
        const base = idx * UPSERT_COLS;
        params.push(
          r.ncode,
          r.nofficeid,
          r.ncalls,
          r.nitem,
          r.vserialno,
          r.nitemserialno,
          r.noldnitem,
          r.voldserialno,
          r.nnewnitem,
          r.vnewserialno,
          r.editedon,
          r.breturntobranch,
          r.dreturntobranchdate,
          r.nreturntobranch,
          r.return_by_name,
          r.vtrnno,
          r.dtrndate,
          r.party_name,
          r.client_name,
          r.model,
          r.machine_serial,
          r.city,
          r.call_centre_call_id,
          r.branch_name,
          r.defective_item_code,
          r.defective_item_name
        );
        const slots = Array.from({ length: UPSERT_COLS }, (_, j) => `$${base + j + 1}`);
        return `(${slots.join(',')}, now())`;
      })
      .join(',\n');

    await client.query(
      `
      INSERT INTO defective_serials (
        ncode, nofficeid, ncalls, nitem, vserialno, nitemserialno,
        noldnitem, voldserialno, nnewnitem, vnewserialno, editedon,
        breturntobranch, dreturntobranchdate, nreturntobranch, return_by_name,
        vtrnno, dtrndate, party_name, client_name, model, machine_serial,
        city, call_centre_call_id, branch_name,
        defective_item_code, defective_item_name, synced_at
      ) VALUES ${valuesSql}
      ON CONFLICT (ncode, nofficeid) DO UPDATE SET
        ncalls = EXCLUDED.ncalls,
        nitem = EXCLUDED.nitem,
        vserialno = EXCLUDED.vserialno,
        nitemserialno = EXCLUDED.nitemserialno,
        noldnitem = EXCLUDED.noldnitem,
        voldserialno = EXCLUDED.voldserialno,
        nnewnitem = EXCLUDED.nnewnitem,
        vnewserialno = EXCLUDED.vnewserialno,
        editedon = EXCLUDED.editedon,
        breturntobranch = EXCLUDED.breturntobranch,
        dreturntobranchdate = EXCLUDED.dreturntobranchdate,
        nreturntobranch = EXCLUDED.nreturntobranch,
        return_by_name = COALESCE(NULLIF(BTRIM(EXCLUDED.return_by_name), ''), defective_serials.return_by_name),
        vtrnno = EXCLUDED.vtrnno,
        dtrndate = EXCLUDED.dtrndate,
        party_name = EXCLUDED.party_name,
        client_name = EXCLUDED.client_name,
        model = EXCLUDED.model,
        machine_serial = EXCLUDED.machine_serial,
        city = EXCLUDED.city,
        call_centre_call_id = EXCLUDED.call_centre_call_id,
        branch_name = EXCLUDED.branch_name,
        defective_item_code = EXCLUDED.defective_item_code,
        defective_item_name = EXCLUDED.defective_item_name,
        synced_at = now()
      `,
      params
    );
  }
  return rows.length;
}

/** One-shot: resolve nreturntobranch → mstusers.vname for rows missing return_by_name. */
export async function backfillDefectiveSerialsReturnByNames(): Promise<{
  ids: number;
  updated: number;
}> {
  const ids = await withClient(async (client) => {
    await ensureDefectiveSerialsTable(client);
    const res = await client.query<{ nreturntobranch: string }>(
      `
      SELECT DISTINCT nreturntobranch
      FROM defective_serials
      WHERE nreturntobranch IS NOT NULL
        AND BTRIM(nreturntobranch) <> ''
        AND (return_by_name IS NULL OR BTRIM(return_by_name) = '')
      `
    );
    return res.rows.map((r) => String(r.nreturntobranch).trim()).filter(Boolean);
  });

  if (ids.length === 0) {
    console.log('[defective-serials] return_by_name backfill: nothing to do');
    return { ids: 0, updated: 0 };
  }

  const nameById = new Map<string, string>();
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const list = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
    // Match as varchar — mstusers.ncode is often a decimal code (e.g. 8.180000000), not an int.
    const res = await postQuery({
      rawSql: `
SELECT CONVERT(varchar(50), u.ncode) AS ncode, u.vname
FROM mstusers u (NOLOCK)
WHERE CONVERT(varchar(50), u.ncode) IN (${list})
`.trim(),
      timeoutMs: 120_000,
    });
    for (const row of (res.data ?? []) as Array<{ ncode?: string; vname?: string }>) {
      const id = String(row.ncode ?? '').trim();
      const name = String(row.vname ?? '').trim();
      if (id && name) nameById.set(id, name);
    }
  }

  let updated = 0;
  await withClient(async (client) => {
    for (const [id, name] of nameById) {
      const res = await client.query<{ ncode: string }>(
        `
        UPDATE defective_serials
        SET return_by_name = $2
        WHERE nreturntobranch = $1
          AND (return_by_name IS NULL OR BTRIM(return_by_name) = '')
        RETURNING ncode
        `,
        [id, name]
      );
      updated += res.rows.length;
    }
  });

  console.log(
    `[defective-serials] return_by_name backfill: ${ids.length} ids → ${nameById.size} names, ${updated} rows`
  );
  return { ids: ids.length, updated };
}

async function fetchCrmChunk(editedFrom: string | null, afterNcode: string | null) {
  const res = await postQuery({
    rawSql: buildDefectiveSerialsCrmSql({
      editedFrom,
      afterNcode,
      top: CHUNK_TOP,
    }),
    timeoutMs: 180_000,
  });
  return ((res.data ?? []) as Record<string, unknown>[])
    .map(mapCrmRow)
    .filter((r): r is DefectiveSerialSyncRow => r != null);
}

/**
 * Full backfill pages by (editedon, ncode) keyset; incremental uses sync_state watermark.
 */
export async function syncDefectiveSerialsToPostgres(opts?: {
  forceFull?: boolean;
}): Promise<{ success: boolean; count: number; mode: string }> {
  const lastWatermark = await withClient(async (client) => {
    await ensureDefectiveSerialsTable(client);
    if (opts?.forceFull) return null;
    const stateRes = await client.query<{ last_editedon: Date | null }>(
      `SELECT last_editedon FROM sync_state WHERE entity = $1`,
      [ENTITY]
    );
    return stateRes.rows[0]?.last_editedon
      ? new Date(stateRes.rows[0].last_editedon)
      : null;
  });

  const mode = !lastWatermark || opts?.forceFull ? 'full' : 'incremental';
  let editedFrom: string | null = null;
  let afterNcode: string | null = null;
  if (mode === 'incremental' && lastWatermark) {
    const overlap = new Date(lastWatermark.getTime() - OVERLAP_MS);
    editedFrom = overlap.toISOString().slice(0, 19);
  }

  let total = 0;
  let maxEdited: Date | null = lastWatermark;
  let loops = 0;
  const maxLoops = 20_000;

  console.log(`[defective-serials] Starting ${mode} sync…`);

  while (loops < maxLoops) {
    loops += 1;
    const batch = await fetchCrmChunk(editedFrom, afterNcode);
    if (batch.length === 0) break;

    const upserted = await withClient(async (client) => upsertRows(client, batch));
    total += upserted;

    const last = batch[batch.length - 1]!;
    if (last.editedon) {
      if (!maxEdited || last.editedon > maxEdited) maxEdited = last.editedon;
    }
    if (!last.editedonKey) break;
    editedFrom = last.editedonKey;
    afterNcode = last.ncode;

    console.log(
      `[defective-serials] chunk ${loops}: +${upserted} (total ${total}), after=${editedFrom}/${afterNcode}`
    );

    if (batch.length < CHUNK_TOP) break;
  }

  await withClient(async (client) => {
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
      [ENTITY, maxEdited, total]
    );
  });

  console.log(`[defective-serials] Done ${mode}: ${total} rows`);
  return { success: true, count: total, mode };
}

export { ensureDefectiveSerialsTable, ENTITY as DEFECTIVE_SERIALS_ENTITY };
