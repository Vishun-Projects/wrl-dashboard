/**
 * Stream MB51 movements from Postgres one stock-key at a time, run FIFO,
 * and materialize thin snapshot rows. Never loads the full import into one array.
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BUCKETS,
  DEFAULT_DEFECTIVE_MATERIALS,
} from '@/modules/mb51-aging/fifo';
import type {
  Mb51AgingGroupBy,
  Mb51AgingMovement,
  Mb51AgingReportParams,
  Mb51AgingSummary,
  Mb51AgingThinRow,
} from '@/modules/mb51-aging/types';
import { withAppClient } from '@/lib/read-model/db';

export const DEFAULT_PARAM_HASH = 'default';
const EPS = 1e-6;
const SCAN_PAGE = 25_000;
const AGG_INSERT_BATCH = 500;
const SNAPSHOT_TIMEOUT_MS = 600_000;

type DbMov = {
  posting_date_serial: number;
  qty: string;
  material: string;
  material_description: string;
  material_group: string;
  uom: string;
  vendor: string;
  vendor_name: string;
  plant: string;
  material_document: string;
  movement_type: string;
  movement_type_text: string;
  item_text: string;
  seq_order: number;
};

function toMov(r: DbMov): Mb51AgingMovement {
  return {
    d: r.posting_date_serial,
    q: Number(r.qty),
    m: r.material,
    md: r.material_description,
    g: r.material_group,
    u: r.uom,
    v: r.vendor,
    vn: r.vendor_name,
    mv: r.plant,
    s: r.seq_order,
    dc: r.material_document,
    mt: r.movement_type,
    mtx: r.movement_type_text,
    tx: r.item_text,
  };
}

function stockKey(r: Mb51AgingMovement): string {
  return `${r.mv}|${r.v}|${r.m}|${r.u}`;
}

function aggKey(r: Mb51AgingMovement, groupBy: Mb51AgingGroupBy): string {
  switch (groupBy) {
    case 'vendor':
      return `${r.v}|${r.u}`;
    case 'group':
      return `${r.g}|${r.u}`;
    case 'vm':
      return `${r.v}|${r.m}|${r.u}`;
    default:
      return `${r.m}|${r.u}`;
  }
}

function aggFields(
  r: Mb51AgingMovement,
  groupBy: Mb51AgingGroupBy
): Pick<Mb51AgingThinRow, 'a' | 'b' | 'c' | 'd' | 'e' | 'u'> {
  switch (groupBy) {
    case 'vendor':
      return { a: r.v, b: r.vn, u: r.u };
    case 'group':
      return { c: r.g, u: r.u };
    case 'vm':
      return { a: r.v, b: r.vn, c: r.g, d: r.m, e: r.md, u: r.u };
    default:
      return { c: r.g, d: r.m, e: r.md, u: r.u };
  }
}

export function hashReportParams(p: Mb51AgingReportParams): string {
  const norm = {
    basis: p.basis,
    from: p.from,
    to: p.to,
    groupBy: p.groupBy,
    plants: [...p.plants].sort(),
    vendors: [...p.vendors].sort(),
    groups: [...p.groups].sort(),
    materials: [...p.materials].sort(),
    excludedMaterials: [...p.excludedMaterials].sort(),
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 24);
}

export type FifoComputeResult = {
  summary: Omit<Mb51AgingSummary, 'paramHash'>;
  rows: Mb51AgingThinRow[];
};

/** Pure FIFO over already-grouped stock keys (for checks + detail). */
export function fifoFromStockGroups(
  groups: Mb51AgingMovement[][],
  opts: {
    basis: number;
    from: number;
    to: number;
    groupBy: Mb51AgingGroupBy;
    maxD: number;
    excluded: Set<string>;
    plants: Set<string>;
    vendors: Set<string>;
    groups: Set<string>;
    materials: Set<string>;
    /** When true, keep det layers on a side map keyed by groupKey (detail only). */
    withLayers?: boolean;
  }
): FifoComputeResult & {
  layersByKey?: Map<string, [Mb51AgingMovement, number, number][][]>;
} {
  const lim = Math.min(opts.basis, opts.to);
  const agg = new Map<string, Mb51AgingThinRow>();
  const layersByKey = opts.withLayers
    ? new Map<string, [Mb51AgingMovement, number, number][][]>()
    : undefined;
  const tot = BUCKETS.map(() => 0);
  let layers = 0,
    negMat = 0,
    negQty = 0,
    plugged = 0,
    plugQty = 0,
    stockMat = 0,
    fullTot = 0;

  const ensure = (r: Mb51AgingMovement): Mb51AgingThinRow => {
    const key = aggKey(r, opts.groupBy);
    let rec = agg.get(key);
    if (!rec) {
      rec = {
        groupKey: key,
        ...aggFields(r, opts.groupBy),
        bk: BUCKETS.map(() => 0),
        total: 0,
        full: 0,
        n: 0,
      };
      agg.set(key, rec);
      if (layersByKey) layersByKey.set(key, BUCKETS.map(() => []));
    }
    return rec;
  };

  for (const a of groups) {
    if (!a.length) continue;
    const f = a[0];
    if (opts.excluded.size && opts.excluded.has(f.m)) continue;
    if (opts.plants.size && !opts.plants.has(f.mv)) continue;
    if (opts.vendors.size && !opts.vendors.has(f.v)) continue;
    if (opts.groups.size && !opts.groups.has(f.g)) continue;
    if (opts.materials.size && !opts.materials.has(f.m)) continue;

    let full = 0;
    for (const r of a) full += r.q;

    let bal = 0;
    let first: Mb51AgingMovement | null = null;
    for (const r of a) {
      if (r.d > lim) break;
      if (r.d < opts.from) continue;
      if (!first) first = r;
      bal += r.q;
    }

    const lay: [Mb51AgingMovement, number][] = [];
    if (bal <= EPS) {
      if (bal < -EPS) {
        negMat++;
        negQty += bal;
      }
    } else {
      stockMat++;
      let rem = bal;
      for (let i = a.length - 1; i >= 0 && rem > EPS; i--) {
        const r = a[i];
        if (r.d > lim || r.d < opts.from || r.q <= 0) continue;
        const take = Math.min(r.q, rem);
        rem -= take;
        lay.push([r, take]);
      }
      if (rem > EPS && first) {
        lay.push([
          {
            d: first.d,
            v: first.v,
            vn: first.vn,
            m: first.m,
            md: first.md,
            g: first.g,
            u: first.u,
            mv: first.mv,
            dc: '(balance not covered by receipts in file)',
            mt: '',
            mtx: '',
            tx: '',
            q: rem,
            s: first.s,
          },
          rem,
        ]);
        plugged++;
        plugQty += rem;
      }
    }

    const touched = new Set<Mb51AgingThinRow>();
    for (const [r, q] of lay) {
      const age = opts.basis - r.d;
      let bi = 0;
      while (bi < BUCKETS.length - 1 && age > BUCKETS[bi].max) bi++;
      const rec = ensure(r);
      rec.bk[bi] += q;
      rec.total += q;
      rec.n++;
      tot[bi] += q;
      layers++;
      touched.add(rec);
      layersByKey?.get(rec.groupKey)?.[bi].push([r, q, age]);
    }
    if (!touched.size && Math.abs(full) > EPS) touched.add(ensure(f));
    for (const rec of touched) {
      rec.full += full;
    }
    if (touched.size) fullTot += full;
  }

  return {
    summary: {
      tot,
      gb: opts.groupBy,
      basis: opts.basis,
      from: opts.from,
      to: opts.to,
      maxD: opts.maxD,
      fullTot,
      used: layers,
      negMat,
      negQty,
      plugged,
      plugQty,
      stockMat,
      rowCount: agg.size,
    },
    rows: [...agg.values()],
    layersByKey,
  };
}

async function fetchBounds(
  client: PoolClient,
  importId: string
): Promise<{ minD: number; maxD: number }> {
  const res = await client.query<{ min_d: number | null; max_d: number | null }>(
    `
    SELECT min(posting_date_serial)::int AS min_d,
           max(posting_date_serial)::int AS max_d
    FROM mb51_aging_rows
    WHERE import_id = $1
    `,
    [importId]
  );
  return {
    minD: res.rows[0]?.min_d ?? 0,
    maxD: res.rows[0]?.max_d ?? 0,
  };
}

/** Excel serial for a UTC calendar day (matches client dateToSerial). */
function isoDayToSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25569;
}

export async function resolveDefaultParams(
  client: PoolClient,
  importId: string
): Promise<Mb51AgingReportParams> {
  const { minD, maxD } = await fetchBounds(client, importId);
  const present = await client.query<{ material: string }>(
    `
    SELECT DISTINCT material
    FROM mb51_aging_rows
    WHERE import_id = $1
      AND material = ANY($2::text[])
    `,
    [importId, [...DEFAULT_DEFECTIVE_MATERIALS]]
  );
  // Basis = today (age as of report day). Posting window still ends at max posting in file.
  const today = new Date().toISOString().slice(0, 10);
  return {
    basis: isoDayToSerial(today),
    from: minD,
    to: maxD,
    groupBy: 'vm',
    plants: [],
    vendors: [],
    groups: [],
    materials: [],
    excludedMaterials: present.rows.map((r) => r.material),
  };
}

async function streamCompute(
  client: PoolClient,
  importId: string,
  params: Mb51AgingReportParams
): Promise<FifoComputeResult> {
  const { maxD } = await fetchBounds(client, importId);
  const excluded = new Set(params.excludedMaterials);
  const plants = new Set(params.plants);
  const vendors = new Set(params.vendors);
  const groups = new Set(params.groups);
  const materials = new Set(params.materials);

  const agg = new Map<string, Mb51AgingThinRow>();
  const tot = BUCKETS.map(() => 0);
  let layers = 0,
    negMat = 0,
    negQty = 0,
    plugged = 0,
    plugQty = 0,
    stockMat = 0,
    fullTot = 0;

  const ensure = (r: Mb51AgingMovement): Mb51AgingThinRow => {
    const key = aggKey(r, params.groupBy);
    let rec = agg.get(key);
    if (!rec) {
      rec = {
        groupKey: key,
        ...aggFields(r, params.groupBy),
        bk: BUCKETS.map(() => 0),
        total: 0,
        full: 0,
        n: 0,
      };
      agg.set(key, rec);
    }
    return rec;
  };

  const processGroup = (a: Mb51AgingMovement[]) => {
    if (!a.length) return;
    const f = a[0];
    if (excluded.size && excluded.has(f.m)) return;
    if (plants.size && !plants.has(f.mv)) return;
    if (vendors.size && !vendors.has(f.v)) return;
    if (groups.size && !groups.has(f.g)) return;
    if (materials.size && !materials.has(f.m)) return;

    const lim = Math.min(params.basis, params.to);
    let full = 0;
    for (const r of a) full += r.q;

    let bal = 0;
    let first: Mb51AgingMovement | null = null;
    for (const r of a) {
      if (r.d > lim) break;
      if (r.d < params.from) continue;
      if (!first) first = r;
      bal += r.q;
    }

    const lay: [Mb51AgingMovement, number][] = [];
    if (bal <= EPS) {
      if (bal < -EPS) {
        negMat++;
        negQty += bal;
      }
    } else {
      stockMat++;
      let rem = bal;
      for (let i = a.length - 1; i >= 0 && rem > EPS; i--) {
        const r = a[i];
        if (r.d > lim || r.d < params.from || r.q <= 0) continue;
        const take = Math.min(r.q, rem);
        rem -= take;
        lay.push([r, take]);
      }
      if (rem > EPS && first) {
        lay.push([
          {
            ...first,
            dc: '(balance not covered by receipts in file)',
            mt: '',
            mtx: '',
            tx: '',
            q: rem,
          },
          rem,
        ]);
        plugged++;
        plugQty += rem;
      }
    }

    const touched = new Set<Mb51AgingThinRow>();
    for (const [r, q] of lay) {
      const age = params.basis - r.d;
      let bi = 0;
      while (bi < BUCKETS.length - 1 && age > BUCKETS[bi].max) bi++;
      const rec = ensure(r);
      rec.bk[bi] += q;
      rec.total += q;
      rec.n++;
      tot[bi] += q;
      layers++;
      touched.add(rec);
    }
    if (!touched.size && Math.abs(full) > EPS) touched.add(ensure(f));
    for (const rec of touched) rec.full += full;
    if (touched.size) fullTot += full;
  };

  let pending: Mb51AgingMovement[] = [];
  let pendingKey = '';
  let afterPlant = '';
  let afterVendor = '';
  let afterMaterial = '';
  let afterUom = '';
  let afterDate = -1;
  let afterSeq = -1;

  for (;;) {
    const page = await client.query<DbMov>(
      `
      SELECT
        posting_date_serial, qty, material, material_description, material_group,
        uom, vendor, vendor_name, plant, material_document, movement_type,
        movement_type_text, item_text, seq_order
      FROM mb51_aging_rows
      WHERE import_id = $1
        AND (
          plant, vendor, material, uom, posting_date_serial, seq_order
        ) > ($2, $3, $4, $5, $6, $7)
      ORDER BY plant, vendor, material, uom, posting_date_serial, seq_order
      LIMIT $8
      `,
      [
        importId,
        afterPlant,
        afterVendor,
        afterMaterial,
        afterUom,
        afterDate,
        afterSeq,
        SCAN_PAGE,
      ]
    );
    if (!page.rows.length) break;

    for (const raw of page.rows) {
      const mov = toMov(raw);
      const sk = stockKey(mov);
      if (!pendingKey) {
        pendingKey = sk;
        pending = [mov];
      } else if (sk === pendingKey) {
        pending.push(mov);
      } else {
        processGroup(pending);
        pendingKey = sk;
        pending = [mov];
      }
    }

    const last = page.rows[page.rows.length - 1];
    afterPlant = last.plant;
    afterVendor = last.vendor;
    afterMaterial = last.material;
    afterUom = last.uom;
    afterDate = last.posting_date_serial;
    afterSeq = last.seq_order;

    if (page.rows.length < SCAN_PAGE) break;
  }
  if (pending.length) processGroup(pending);

  return {
    summary: {
      tot,
      gb: params.groupBy,
      basis: params.basis,
      from: params.from,
      to: params.to,
      maxD: Math.max(maxD, params.basis),
      fullTot,
      used: layers,
      negMat,
      negQty,
      plugged,
      plugQty,
      stockMat,
      rowCount: agg.size,
    },
    rows: [...agg.values()],
  };
}

async function writeSnapshot(
  client: PoolClient,
  importId: string,
  paramHash: string,
  params: Mb51AgingReportParams,
  computed: FifoComputeResult
): Promise<string> {
  await client.query(
    `DELETE FROM mb51_aging_snapshots WHERE import_id = $1 AND param_hash = $2`,
    [importId, paramHash]
  );

  const ins = await client.query<{ id: string }>(
    `
    INSERT INTO mb51_aging_snapshots (import_id, param_hash, params, summary, row_count)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
    RETURNING id
    `,
    [
      importId,
      paramHash,
      JSON.stringify(params),
      JSON.stringify(computed.summary),
      computed.rows.length,
    ]
  );
  const snapshotId = ins.rows[0]?.id;
  if (!snapshotId) throw new Error('Failed to create MB51 snapshot');

  for (let i = 0; i < computed.rows.length; i += AGG_INSERT_BATCH) {
    const chunk = computed.rows.slice(i, i + AGG_INSERT_BATCH);
    const values: unknown[] = [];
    const ph: string[] = [];
    let p = 1;
    for (let j = 0; j < chunk.length; j++) {
      const r = chunk[j];
      ph.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
      );
      values.push(
        snapshotId,
        i + j,
        r.groupKey,
        r.a ?? '',
        r.b ?? '',
        r.c ?? '',
        r.d ?? '',
        r.e ?? '',
        r.u ?? '',
        r.bk,
        r.total,
        r.full,
        r.n
      );
    }
    await client.query(
      `
      INSERT INTO mb51_aging_agg_rows (
        snapshot_id, seq, group_key, vendor, vendor_name, material_group,
        material, material_description, uom, bk, total, full_qty, n
      ) VALUES ${ph.join(',')}
      `,
      values
    );
  }
  return snapshotId;
}

/** Build (or rebuild) a snapshot for the given params. */
export async function materializeMb51Snapshot(opts: {
  importId: string;
  params?: Mb51AgingReportParams;
  paramHash?: string;
}): Promise<{ paramHash: string; summary: Mb51AgingSummary; snapshotId: string }> {
  return withAppClient(
    async (client) => {
      const params =
        opts.params ?? (await resolveDefaultParams(client, opts.importId));
      const paramHash =
        opts.paramHash ??
        (opts.params ? hashReportParams(params) : DEFAULT_PARAM_HASH);

      const computed = await streamCompute(client, opts.importId, params);

      // True DISTINCT counts for filter labels (once per snapshot — not the capped dropdown list).
      const totalsRes = await client.query<{
        vendors: number;
        materials: number;
        groups: number;
        plants: number;
        movements: number;
      }>(
        `
        SELECT
          count(DISTINCT NULLIF(vendor, ''))::int AS vendors,
          count(DISTINCT NULLIF(material, ''))::int AS materials,
          count(DISTINCT NULLIF(material_group, ''))::int AS groups,
          count(DISTINCT NULLIF(plant, ''))::int AS plants,
          count(DISTINCT NULLIF(movement_type, ''))::int AS movements
        FROM mb51_aging_rows
        WHERE import_id = $1
        `,
        [opts.importId]
      );
      const facetTotals = totalsRes.rows[0] ?? {
        vendors: 0,
        materials: 0,
        groups: 0,
        plants: 0,
        movements: 0,
      };
      const summaryWithTotals = {
        ...computed.summary,
        facetTotals,
        paramHash,
      };
      const toStore = { ...computed, summary: summaryWithTotals };

      await client.query('BEGIN');
      try {
        const snapshotId = await writeSnapshot(
          client,
          opts.importId,
          paramHash,
          params,
          toStore
        );
        await client.query('COMMIT');
        return {
          paramHash,
          snapshotId,
          summary: summaryWithTotals,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
    { statementTimeoutMs: SNAPSHOT_TIMEOUT_MS }
  );
}

export async function buildDefaultSnapshot(importId: string): Promise<void> {
  await materializeMb51Snapshot({ importId, paramHash: DEFAULT_PARAM_HASH });
}
