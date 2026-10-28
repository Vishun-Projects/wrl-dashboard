import { withAppClient } from '@/lib/read-model/db';
import { DEFAULT_DEFECTIVE_MATERIALS } from '@/modules/mb51-aging/fifo';
import {
  DEFAULT_PARAM_HASH,
  fifoFromStockGroups,
  hashReportParams,
  materializeMb51Snapshot,
  type FifoComputeResult,
} from '@/modules/mb51-aging/server/fifo-from-db';
import type {
  Mb51AgingImportMeta,
  Mb51AgingMovement,
  Mb51AgingReportParams,
  Mb51AgingSummary,
  Mb51AgingThinRow,
} from '@/modules/mb51-aging/types';

const LOAD_MS = 120_000;

function toMeta(
  imp: {
    id: string;
    file_name: string;
    uploaded_by: string | null;
    row_count: number;
    plant_count: number;
    material_count: number;
    imported_at: Date;
  },
  extra?: Partial<Mb51AgingImportMeta>
): Mb51AgingImportMeta {
  return {
    id: imp.id,
    fileName: imp.file_name,
    uploadedBy: imp.uploaded_by,
    rowCount: imp.row_count,
    plantCount: imp.plant_count,
    materialCount: imp.material_count,
    importedAt: imp.imported_at.toISOString(),
    ...extra,
  };
}

async function latestImportOn(
  client: import('pg').PoolClient
): Promise<Mb51AgingImportMeta | null> {
  const importRes = await client.query<{
    id: string;
    file_name: string;
    uploaded_by: string | null;
    row_count: number;
    plant_count: number;
    material_count: number;
    imported_at: Date;
  }>(
    `
    SELECT id, file_name, uploaded_by, row_count, plant_count, material_count, imported_at
    FROM mb51_aging_imports
    ORDER BY imported_at DESC
    LIMIT 1
    `
  );
  if (!importRes.rows[0]) return null;

  const imp = importRes.rows[0];
  const bounds = await client.query<{
    min_d: number | null;
    max_d: number | null;
  }>(
    `
    SELECT min(posting_date_serial)::int AS min_d,
           max(posting_date_serial)::int AS max_d
    FROM mb51_aging_rows WHERE import_id = $1
    `,
    [imp.id]
  );
  const snap = await client.query<{ id: string }>(
    `
    SELECT id FROM mb51_aging_snapshots
    WHERE import_id = $1 AND param_hash = $2
    LIMIT 1
    `,
    [imp.id, DEFAULT_PARAM_HASH]
  );

  return toMeta(imp, {
    snapshotReady: snap.rows.length > 0,
    minPostingSerial: bounds.rows[0]?.min_d ?? undefined,
    maxPostingSerial: bounds.rows[0]?.max_d ?? undefined,
  });
}

export async function fetchMb51Meta(): Promise<{
  latestImport: Mb51AgingImportMeta | null;
}> {
  return withAppClient(
    async (client) => ({ latestImport: await latestImportOn(client) }),
    { statementTimeoutMs: LOAD_MS }
  );
}

async function loadSnapshotSummary(
  client: import('pg').PoolClient,
  importId: string,
  paramHash: string
): Promise<{
  snapshotId: string;
  summary: Mb51AgingSummary;
  params: Mb51AgingReportParams;
} | null> {
  const res = await client.query<{
    id: string;
    summary: Mb51AgingSummary;
    params: Mb51AgingReportParams;
  }>(
    `
    SELECT id, summary, params
    FROM mb51_aging_snapshots
    WHERE import_id = $1 AND param_hash = $2
    LIMIT 1
    `,
    [importId, paramHash]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    snapshotId: row.id,
    summary: { ...row.summary, paramHash },
    params: row.params,
  };
}

export async function fetchMb51Summary(paramHash = DEFAULT_PARAM_HASH): Promise<{
  latestImport: Mb51AgingImportMeta | null;
  summary: Mb51AgingSummary | null;
  params: Mb51AgingReportParams | null;
}> {
  return withAppClient(
    async (client) => {
      const latestImport = await latestImportOn(client);
      if (!latestImport) {
        return { latestImport: null, summary: null, params: null };
      }
      const snap = await loadSnapshotSummary(client, latestImport.id, paramHash);
      return {
        latestImport: { ...latestImport, snapshotReady: !!snap },
        summary: snap?.summary ?? null,
        params: snap?.params ?? null,
      };
    },
    { statementTimeoutMs: LOAD_MS }
  );
}

export async function fetchMb51AggPage(opts: {
  paramHash?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: string;
  sortDir?: 1 | -1;
}): Promise<{
  rows: Mb51AgingThinRow[];
  total: number;
  page: number;
  pageSize: number;
  paramHash: string;
}> {
  const paramHash = opts.paramHash || DEFAULT_PARAM_HASH;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(500, Math.max(1, Math.floor(opts.pageSize ?? 100)));
  const q = (opts.q || '').trim().toLowerCase();
  const sort = opts.sort || 'total';
  const sortDir = opts.sortDir === 1 ? 1 : -1;

  return withAppClient(
    async (client) => {
      const latestImport = await latestImportOn(client);
      if (!latestImport) {
        return { rows: [], total: 0, page, pageSize, paramHash };
      }
      const snap = await loadSnapshotSummary(
        client,
        latestImport.id,
        paramHash
      );
      if (!snap) return { rows: [], total: 0, page, pageSize, paramHash };

      const sortSql =
        sort === 'full'
          ? 'full_qty'
          : sort === 'a'
            ? 'vendor'
            : sort === 'b'
              ? 'vendor_name'
              : sort === 'c'
                ? 'material_group'
                : sort === 'd'
                  ? 'material'
                  : sort === 'e'
                    ? 'material_description'
                    : sort === 'u'
                      ? 'uom'
                      : sort.startsWith('b') && /^b\d$/.test(sort)
                        ? `bk[${Number(sort[1])}]`
                        : 'total';

      const where = q
        ? `AND (
            lower(vendor) LIKE $3 OR lower(vendor_name) LIKE $3 OR
            lower(material) LIKE $3 OR lower(material_description) LIKE $3 OR
            lower(material_group) LIKE $3 OR lower(uom) LIKE $3 OR
            lower(group_key) LIKE $3
          )`
        : '';
      const like = q ? `%${q}%` : null;
      const countParams = like
        ? [snap.snapshotId, like]
        : [snap.snapshotId];
      const countRes = await client.query<{ n: number }>(
        `
        SELECT count(*)::int AS n
        FROM mb51_aging_agg_rows
        WHERE snapshot_id = $1
        ${where.replace(/\$3/g, '$2')}
        `,
        countParams
      );
      const total = countRes.rows[0]?.n ?? 0;
      const offset = (page - 1) * pageSize;
      const listParams = like
        ? [snap.snapshotId, pageSize, offset, like]
        : [snap.snapshotId, pageSize, offset];
      const listWhere = like
        ? where.replace(/\$3/g, '$4')
        : '';

      const list = await client.query<{
        group_key: string;
        vendor: string;
        vendor_name: string;
        material_group: string;
        material: string;
        material_description: string;
        uom: string;
        bk: string[] | number[];
        total: string;
        full_qty: string;
        n: number;
      }>(
        `
        SELECT group_key, vendor, vendor_name, material_group, material,
               material_description, uom, bk, total, full_qty, n
        FROM mb51_aging_agg_rows
        WHERE snapshot_id = $1
        ${listWhere}
        ORDER BY ${sortSql} ${sortDir > 0 ? 'ASC' : 'DESC'} NULLS LAST, seq ASC
        LIMIT $2 OFFSET $3
        `,
        listParams
      );

      const rows: Mb51AgingThinRow[] = list.rows.map((r) => ({
        groupKey: r.group_key,
        a: r.vendor || undefined,
        b: r.vendor_name || undefined,
        c: r.material_group || undefined,
        d: r.material || undefined,
        e: r.material_description || undefined,
        u: r.uom || undefined,
        bk: (r.bk || []).map(Number),
        total: Number(r.total),
        full: Number(r.full_qty),
        n: r.n,
      }));

      return { rows, total, page, pageSize, paramHash };
    },
    { statementTimeoutMs: LOAD_MS }
  );
}

export async function rebuildMb51Report(
  params: Mb51AgingReportParams
): Promise<{ summary: Mb51AgingSummary; paramHash: string }> {
  const meta = await fetchMb51Meta();
  if (!meta.latestImport) throw new Error('No MB51 import found');
  const paramHash = hashReportParams(params);
  const built = await materializeMb51Snapshot({
    importId: meta.latestImport.id,
    params,
    paramHash,
  });
  return { summary: built.summary, paramHash: built.paramHash };
}

export async function fetchMb51Detail(opts: {
  paramHash?: string;
  groupKey: string;
  /** >=0 bucket index; -1 all aging buckets; -2 net-stock mode */
  bucketIdx: number;
}): Promise<{
  lines: [Mb51AgingMovement, number, number][];
  net?: { pos: number; neg: number; net: number; n: number; r: Mb51AgingMovement }[];
}> {
  const paramHash = opts.paramHash || DEFAULT_PARAM_HASH;
  return withAppClient(
    async (client) => {
      const latestImport = await latestImportOn(client);
      if (!latestImport) return { lines: [] };
      const snap = await loadSnapshotSummary(
        client,
        latestImport.id,
        paramHash
      );
      if (!snap) return { lines: [] };
      const params = snap.params;
      const key = opts.groupKey;

      // Resolve which stock groups feed this agg key
      let sqlFilter = '';
      const filterVals: unknown[] = [latestImport.id];
      if (params.groupBy === 'vendor') {
        const [v, u] = key.split('|');
        sqlFilter = `AND vendor = $2 AND uom = $3`;
        filterVals.push(v, u);
      } else if (params.groupBy === 'group') {
        const [g, u] = key.split('|');
        sqlFilter = `AND material_group = $2 AND uom = $3`;
        filterVals.push(g, u);
      } else if (params.groupBy === 'vm') {
        const [v, m, u] = key.split('|');
        sqlFilter = `AND vendor = $2 AND material = $3 AND uom = $4`;
        filterVals.push(v, m, u);
      } else {
        const [m, u] = key.split('|');
        sqlFilter = `AND material = $2 AND uom = $3`;
        filterVals.push(m, u);
      }

      const movRes = await client.query<{
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
      }>(
        `
        SELECT posting_date_serial, qty, material, material_description, material_group,
               uom, vendor, vendor_name, plant, material_document, movement_type,
               movement_type_text, item_text, seq_order
        FROM mb51_aging_rows
        WHERE import_id = $1
        ${sqlFilter}
        ORDER BY plant, vendor, material, uom, posting_date_serial, seq_order
        `,
        filterVals
      );

      const byStock = new Map<string, Mb51AgingMovement[]>();
      for (const raw of movRes.rows) {
        const mov: Mb51AgingMovement = {
          d: raw.posting_date_serial,
          q: Number(raw.qty),
          m: raw.material,
          md: raw.material_description,
          g: raw.material_group,
          u: raw.uom,
          v: raw.vendor,
          vn: raw.vendor_name,
          mv: raw.plant,
          s: raw.seq_order,
          dc: raw.material_document,
          mt: raw.movement_type,
          mtx: raw.movement_type_text,
          tx: raw.item_text,
        };
        const sk = `${mov.mv}|${mov.v}|${mov.m}|${mov.u}`;
        let a = byStock.get(sk);
        if (!a) {
          a = [];
          byStock.set(sk, a);
        }
        a.push(mov);
      }

      if (opts.bucketIdx === -2) {
        const L: {
          pos: number;
          neg: number;
          net: number;
          n: number;
          r: Mb51AgingMovement;
        }[] = [];
        for (const a of byStock.values()) {
          let pos = 0,
            neg = 0;
          for (const r of a) {
            if (r.q > 0) pos += r.q;
            else neg += r.q;
          }
          const net = pos + neg;
          if (Math.abs(net) < 1e-9) continue;
          L.push({ r: a[0], pos, neg, net, n: a.length });
        }
        L.sort((x, y) => x.net - y.net);
        return { lines: [], net: L };
      }

      const computed = fifoFromStockGroups([...byStock.values()], {
        basis: params.basis,
        from: params.from,
        to: params.to,
        groupBy: params.groupBy,
        maxD: params.basis,
        excluded: new Set(params.excludedMaterials),
        plants: new Set(params.plants),
        vendors: new Set(params.vendors),
        groups: new Set(params.groups),
        materials: new Set(params.materials),
        withLayers: true,
      }) as FifoComputeResult & {
        layersByKey?: Map<string, [Mb51AgingMovement, number, number][][]>;
      };

      const det = computed.layersByKey?.get(key) ?? [];
      const lines =
        opts.bucketIdx < 0
          ? ([] as [Mb51AgingMovement, number, number][]).concat(...det)
          : det[opts.bucketIdx] || [];
      return { lines };
    },
    { statementTimeoutMs: LOAD_MS }
  );
}

export async function fetchMb51Facets(opts?: {
  q?: string;
  limit?: number;
}): Promise<{
  plants: { id: string; text: string }[];
  vendors: { id: string; text: string }[];
  groups: { id: string; text: string }[];
  materials: { id: string; text: string }[];
  movements: { id: string; text: string }[];
  totals: {
    vendors: number;
    materials: number;
    groups: number;
    plants: number;
    movements: number;
  };
}> {
  const limit = Math.min(2000, Math.max(1, opts?.limit ?? 2000));
  const q = (opts?.q || '').trim().toLowerCase();
  const emptyTotals = {
    vendors: 0,
    materials: 0,
    groups: 0,
    plants: 0,
    movements: 0,
  };
  return withAppClient(
    async (client) => {
      const latestImport = await latestImportOn(client);
      if (!latestImport) {
        return {
          plants: [],
          vendors: [],
          groups: [],
          materials: [],
          movements: [],
          totals: emptyTotals,
        };
      }
      const id = latestImport.id;
      const like = q ? `%${q}%` : null;

      // Prefer totals baked into the default snapshot (fast); fall back to COUNT.
      let totals = emptyTotals;
      const snap = await loadSnapshotSummary(client, id, DEFAULT_PARAM_HASH);
      if (snap?.summary?.facetTotals) {
        totals = snap.summary.facetTotals;
      } else {
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
          [id]
        );
        totals = totalsRes.rows[0] ?? emptyTotals;
      }

      async function distinct(
        col: string,
        labelSql: string
      ): Promise<{ id: string; text: string }[]> {
        const res = await client.query<{ id: string; text: string }>(
          like
            ? `
              SELECT DISTINCT ${col} AS id, ${labelSql} AS text
              FROM mb51_aging_rows
              WHERE import_id = $1 AND ${col} <> ''
                AND lower(${labelSql}) LIKE $2
              ORDER BY text
              LIMIT $3
              `
            : `
              SELECT DISTINCT ${col} AS id, ${labelSql} AS text
              FROM mb51_aging_rows
              WHERE import_id = $1 AND ${col} <> ''
              ORDER BY text
              LIMIT $2
              `,
          like ? [id, like, limit] : [id, limit]
        );
        return res.rows;
      }

      // Always include known defective codes in materials list (for exclude UI).
      const [plants, vendors, groups, materialsRaw, movements] = await Promise.all([
        distinct('plant', `plant`),
        distinct(
          'vendor',
          `vendor || ' - ' || coalesce(nullif(vendor_name,''), '')`
        ),
        distinct('material_group', `material_group`),
        distinct(
          'material',
          `material || ' - ' || coalesce(nullif(material_description,''), '')`
        ),
        distinct(
          'movement_type',
          `movement_type || coalesce(' - ' || nullif(movement_type_text,''), '')`
        ),
      ]);

      const have = new Set(materialsRaw.map((m) => m.id));
      const missing = [...DEFAULT_DEFECTIVE_MATERIALS].filter((m) => !have.has(m));
      let materials = materialsRaw;
      if (missing.length) {
        const extra = await client.query<{ id: string; text: string }>(
          `
          SELECT DISTINCT material AS id,
            material || ' - ' || coalesce(nullif(material_description,''), '') AS text
          FROM mb51_aging_rows
          WHERE import_id = $1 AND material = ANY($2::text[])
          `,
          [id, missing]
        );
        materials = [...extra.rows, ...materialsRaw];
      }

      return { plants, vendors, groups, materials, movements, totals };
    },
    { statementTimeoutMs: LOAD_MS }
  );
}

export async function fetchMb51MovementsPage(opts: {
  afterSeq?: number;
  /** Prefer offset for random page access; afterSeq kept for keyset scans. */
  offset?: number;
  limit?: number;
  dateFrom?: number | null;
  dateTo?: number | null;
  plants?: string[];
  vendors?: string[];
  groups?: string[];
  materials?: string[];
  movements?: string[];
  q?: string;
}): Promise<{
  rows: Mb51AgingMovement[];
  nextAfter: number;
  done: boolean;
  kpis: {
    filteredCount: number;
    netQty: number;
    receiptQty: number;
    issueQty: number;
    uniqueMaterials: number;
    uniqueVendors: number;
    uniquePlants: number;
  };
  totalCount: number;
}> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const afterSeq = Number.isFinite(opts.afterSeq) ? Number(opts.afterSeq) : -1;
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));

  return withAppClient(
    async (client) => {
      const latestImport = await latestImportOn(client);
      if (!latestImport) {
        return {
          rows: [],
          nextAfter: afterSeq,
          done: true,
          kpis: {
            filteredCount: 0,
            netQty: 0,
            receiptQty: 0,
            issueQty: 0,
            uniqueMaterials: 0,
            uniqueVendors: 0,
            uniquePlants: 0,
          },
          totalCount: 0,
        };
      }
      const id = latestImport.id;
      const clauses: string[] = ['import_id = $1'];
      const params: unknown[] = [id];
      let p = 2;

      if (opts.dateFrom != null && Number.isFinite(opts.dateFrom)) {
        clauses.push(`posting_date_serial >= $${p++}`);
        params.push(opts.dateFrom);
      }
      if (opts.dateTo != null && Number.isFinite(opts.dateTo)) {
        clauses.push(`posting_date_serial <= $${p++}`);
        params.push(opts.dateTo);
      }
      if (opts.plants?.length) {
        clauses.push(`plant = ANY($${p++})`);
        params.push(opts.plants);
      }
      if (opts.vendors?.length) {
        clauses.push(`vendor = ANY($${p++})`);
        params.push(opts.vendors);
      }
      if (opts.groups?.length) {
        clauses.push(`material_group = ANY($${p++})`);
        params.push(opts.groups);
      }
      if (opts.materials?.length) {
        clauses.push(`material = ANY($${p++})`);
        params.push(opts.materials);
      }
      if (opts.movements?.length) {
        clauses.push(`movement_type = ANY($${p++})`);
        params.push(opts.movements);
      }
      const q = (opts.q || '').trim().toLowerCase();
      if (q) {
        clauses.push(
          `(lower(material) LIKE $${p} OR lower(material_description) LIKE $${p} OR lower(vendor) LIKE $${p} OR lower(vendor_name) LIKE $${p} OR lower(material_document) LIKE $${p} OR lower(plant) LIKE $${p} OR lower(item_text) LIKE $${p} OR lower(movement_type_text) LIKE $${p})`
        );
        params.push(`%${q}%`);
        p++;
      }

      const where = clauses.join(' AND ');

      const kpiRes = await client.query<{
        filtered_count: number;
        net_qty: string;
        receipt_qty: string;
        issue_qty: string;
        unique_materials: number;
        unique_vendors: number;
        unique_plants: number;
      }>(
        `
        SELECT
          count(*)::int AS filtered_count,
          coalesce(sum(qty), 0) AS net_qty,
          coalesce(sum(qty) FILTER (WHERE qty > 0), 0) AS receipt_qty,
          coalesce(sum(qty) FILTER (WHERE qty < 0), 0) AS issue_qty,
          count(DISTINCT NULLIF(material, ''))::int AS unique_materials,
          count(DISTINCT NULLIF(vendor, ''))::int AS unique_vendors,
          count(DISTINCT NULLIF(plant, ''))::int AS unique_plants
        FROM mb51_aging_rows
        WHERE ${where}
        `,
        params
      );
      const k = kpiRes.rows[0];

      const useOffset = opts.offset != null;
      const pageParams = useOffset
        ? [...params, limit, offset]
        : [...params, afterSeq, limit];
      const pageRes = await client.query<{
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
      }>(
        useOffset
          ? `
        SELECT posting_date_serial, qty, material, material_description, material_group,
               uom, vendor, vendor_name, plant, material_document, movement_type,
               movement_type_text, item_text, seq_order
        FROM mb51_aging_rows
        WHERE ${where}
        ORDER BY seq_order ASC
        LIMIT $${p} OFFSET $${p + 1}
        `
          : `
        SELECT posting_date_serial, qty, material, material_description, material_group,
               uom, vendor, vendor_name, plant, material_document, movement_type,
               movement_type_text, item_text, seq_order
        FROM mb51_aging_rows
        WHERE ${where}
          AND seq_order > $${p}
        ORDER BY seq_order ASC
        LIMIT $${p + 1}
        `,
        pageParams
      );

      const rows: Mb51AgingMovement[] = pageRes.rows.map((r) => ({
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
      }));

      return {
        rows,
        nextAfter: rows.length ? rows[rows.length - 1].s : afterSeq,
        done: rows.length < limit,
        totalCount: latestImport.rowCount,
        kpis: {
          filteredCount: k?.filtered_count ?? 0,
          netQty: Number(k?.net_qty ?? 0),
          receiptQty: Number(k?.receipt_qty ?? 0),
          issueQty: Number(k?.issue_qty ?? 0),
          uniqueMaterials: k?.unique_materials ?? 0,
          uniqueVendors: k?.unique_vendors ?? 0,
          uniquePlants: k?.unique_plants ?? 0,
        },
      };
    },
    { statementTimeoutMs: LOAD_MS }
  );
}
