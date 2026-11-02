import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';

export type CallPartsFilterInput = {
  allTime: boolean;
  startDate: string;
  endDate: string;
  search: string;
  plant: string;
  branch: string;
  client: string;
  customer: string;
  engineer: string;
  status: string;
  /** Part name or code contains. */
  part: string;
  /** Exact item-category name (compressor, motor, …). */
  category: string;
  /** Consumption SAP doc: __has__ / __blank__ / contains. */
  sapDoc: string;
  /** Defective Generation SAP doc: __has__ / __blank__ / contains (SQL). */
  sapDocDefective: string;
  /** Defective Receipt SAP doc: __has__ / __blank__ / contains. */
  sapDocReceipt: string;
  isHod: boolean;
  assignedOffices: string[];
};

export type CallPartsFilterSql = { where: string; params: unknown[] };

function ilikeParam(raw: string): string {
  const escaped = raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

export const CALL_PARTS_FROM = `
  FROM calls_latest_hot h
  JOIN LATERAL (
    SELECT *
    FROM call_parts p
    WHERE p.call_no = h.vtrnno
    -- ponytail: OFFSET 0 keeps the nested loop on idx_call_parts_call_no. Without it Postgres seq-scans every part row.
    OFFSET 0
  ) p ON true
`;

export const CALL_PARTS_PLANT = `NULLIF(btrim(h.branch_name), '')`;
export const CALL_PARTS_BRANCH = `NULLIF(btrim(h.franchisee_name), '')`;
export const CALL_PARTS_CLIENT = `NULLIF(btrim(h.account), '')`;
export const CALL_PARTS_CUSTOMER = `NULLIF(btrim(h.party_name), '')`;
export const CALL_PARTS_STATUS = `NULLIF(btrim(h.status_label), '')`;
export const CALL_PARTS_ENGINEER = `NULLIF(btrim(h.engineer_name), '')`;
export const CALL_PARTS_MODEL = `NULLIF(btrim(h.item_code), '')`;

/** mstitems category (compressor, motor, …) via the synced item master. Not on the count path. */
export const CALL_PARTS_CATEGORY_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(NULLIF(btrim(c.vname), ''), NULLIF(btrim(c.vshortname), '')) AS item_category
    FROM crm_mstitems i
    LEFT JOIN crm_mstitemcategory c ON c.ncode = i.nitemcategory
    WHERE i.norm_vitemcode = regexp_replace(btrim(p.part_code), '^0+', '')
    ORDER BY i.bactive DESC, i.ncode
    LIMIT 1
  ) part_cat ON true
`;
export const CALL_PARTS_CATEGORY = `part_cat.item_category`;

/** Same codes as DEFAULT_DEFECTIVE_MATERIALS in the MB51 aging report. */
const DEFECTIVE_MATERIALS_SQL = `'1301709','1301712','1301714','2303393','2303396','2303398'`;
/** Defective Generation movements → SAP doc (Defective). See sap-doc.ts matrix. */
const DEFECTIVE_GENERATION_MOVEMENT_SQL = `'947','943','944','948'`;
/** Consumption movements → SAP doc. See sap-doc.ts matrix. */
const CONSUMPTION_MOVEMENT_SQL = `'947','943','944','948','702','309'`;
/** Defective Receipt movements → SAP doc (Defective Receipt). */
const DEFECTIVE_RECEIPT_MOVEMENT_SQL = `'941','949','952','942','951','301','302','541'`;

/**
 * CRM call / TRN on upper(btrim(item_text)): 20–29 + A–L month + 5–7 digits (len 8–10).
 * A=Jan … L=Dec. Rejects free text, material codes, and overlong junk.
 */
export const CRM_CALL_NO_SQL_RE = `^2[0-9][A-L][0-9]{5,7}$`;

export const SAP_DOC_HAS = '__has__';
export const SAP_DOC_BLANK = '__blank__';

export type Mb51NotInCrmFilterInput = {
  allTime: boolean;
  startDate: string;
  endDate: string;
  search: string;
  /** Leading plant code from branch filter, or raw plant. */
  plant: string;
  part: string;
  sapDoc: string;
  sapDocDefective: string;
  sapDocReceipt: string;
};

/**
 * MB51 call nos (exact TRN format) with part movements that are absent from CRM hot + mirror.
 * One row per call — for catching manually removed calls that still consumed parts in SAP.
 */
export function buildMb51NotInCrmSql(filters: Mb51NotInCrmFilterInput): {
  sql: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const where: string[] = [
    `r.import_id = (SELECT id FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1)`,
    `btrim(r.item_text) <> ''`,
    `upper(btrim(r.item_text)) ~ '${CRM_CALL_NO_SQL_RE}'`,
  ];

  if (!filters.allTime) {
    params.push(filters.startDate, filters.endDate);
    where.push(
      `r.posting_date >= $${params.length - 1}::date AND r.posting_date <= $${params.length}::date`
    );
  }

  const search = filters.search.trim();
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    where.push(`upper(btrim(r.item_text)) ILIKE $${params.length} ESCAPE '\\'`);
  }

  const plant = filters.plant.trim();
  if (plant) {
    params.push(plant);
    where.push(`btrim(r.plant) = $${params.length}`);
  }

  const part = filters.part.trim();
  if (part) {
    params.push(`%${part.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    const n = params.length;
    where.push(
      `(r.material ILIKE $${n} ESCAPE '\\' OR r.material_description ILIKE $${n} ESCAPE '\\')`
    );
  }

  const bucketCase = `CASE
      WHEN btrim(r.movement_type) IN (${DEFECTIVE_RECEIPT_MOVEMENT_SQL})
       AND r.material IN (${DEFECTIVE_MATERIALS_SQL}) THEN 'receipt'
      WHEN btrim(r.movement_type) IN (${DEFECTIVE_GENERATION_MOVEMENT_SQL})
       AND r.material IN (${DEFECTIVE_MATERIALS_SQL}) THEN 'generation'
      WHEN btrim(r.movement_type) IN (${CONSUMPTION_MOVEMENT_SQL})
       AND r.material NOT IN (${DEFECTIVE_MATERIALS_SQL})
       AND upper(btrim(r.material_description)) NOT LIKE '%(D)%' THEN 'consumption'
      ELSE NULL
    END`;

  const outer: string[] = [];
  const pushSap = (col: string, raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (value === SAP_DOC_HAS) {
      outer.push(`${col} IS NOT NULL`);
      return;
    }
    if (value === SAP_DOC_BLANK) {
      outer.push(`${col} IS NULL`);
      return;
    }
    params.push(`%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    outer.push(`${col} ILIKE $${params.length} ESCAPE '\\'`);
  };
  pushSap('sap_doc', filters.sapDoc);
  pushSap('sap_doc_defective', filters.sapDocDefective);
  pushSap('sap_doc_receipt', filters.sapDocReceipt);

  const sql = `
    WITH lines AS (
      SELECT
        upper(btrim(r.item_text)) AS call_no,
        btrim(r.plant) AS plant,
        btrim(r.vendor) AS vendor,
        regexp_replace(btrim(r.material), '^0+', '') AS material,
        NULLIF(btrim(r.material_description), '') AS description,
        NULLIF(btrim(r.material_document), '') AS material_document,
        r.qty,
        r.posting_date,
        ${bucketCase} AS bucket
      FROM mb51_aging_rows r
      WHERE ${where.join(' AND ')}
    ),
    kept AS (
      SELECT * FROM lines WHERE bucket IS NOT NULL
    ),
    orphan_calls AS (
      SELECT DISTINCT k.call_no
      FROM kept k
      WHERE NOT EXISTS (
              SELECT 1 FROM calls_latest_hot h
              WHERE upper(btrim(h.vtrnno)) = k.call_no
            )
        AND NOT EXISTS (
              SELECT 1 FROM calls_crm_mirror m
              WHERE upper(btrim(m.vtrnno)) = k.call_no
            )
    ),
    agg AS (
      SELECT
        o.call_no,
        string_agg(DISTINCT NULLIF(k.plant, ''), ', ' ORDER BY NULLIF(k.plant, '')) AS plants,
        string_agg(DISTINCT NULLIF(k.vendor, ''), ', ' ORDER BY NULLIF(k.vendor, '')) AS vendors,
        string_agg(DISTINCT NULLIF(k.material, ''), ', ' ORDER BY NULLIF(k.material, ''))
          FILTER (WHERE k.bucket = 'consumption') AS materials,
        string_agg(DISTINCT NULLIF(k.description, ''), ', ' ORDER BY NULLIF(k.description, ''))
          FILTER (WHERE k.bucket = 'consumption') AS descriptions,
        string_agg(DISTINCT k.material_document, ', ' ORDER BY k.material_document)
          FILTER (WHERE k.bucket = 'consumption' AND k.material_document IS NOT NULL) AS sap_doc,
        to_char(min(k.posting_date) FILTER (WHERE k.bucket = 'consumption'), 'YYYY-MM-DD') AS sap_doc_posting_date,
        coalesce(sum(k.qty) FILTER (WHERE k.bucket = 'consumption'), 0) AS cons_qty,
        string_agg(DISTINCT k.material_document, ', ' ORDER BY k.material_document)
          FILTER (WHERE k.bucket = 'generation' AND k.material_document IS NOT NULL) AS sap_doc_defective,
        to_char(min(k.posting_date) FILTER (WHERE k.bucket = 'generation'), 'YYYY-MM-DD') AS sap_doc_defective_posting_date,
        coalesce(sum(k.qty) FILTER (WHERE k.bucket = 'generation'), 0) AS defective_qty,
        string_agg(DISTINCT k.material_document, ', ' ORDER BY k.material_document)
          FILTER (WHERE k.bucket = 'receipt' AND k.material_document IS NOT NULL) AS sap_doc_receipt,
        to_char(min(k.posting_date) FILTER (WHERE k.bucket = 'receipt'), 'YYYY-MM-DD') AS sap_doc_receipt_posting_date,
        coalesce(sum(k.qty) FILTER (WHERE k.bucket = 'receipt'), 0) AS receipt_qty,
        to_char(min(k.posting_date), 'YYYY-MM-DD') AS first_posting_date
      FROM orphan_calls o
      JOIN kept k ON k.call_no = o.call_no
      GROUP BY o.call_no
    )
    SELECT * FROM agg
    ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
    ORDER BY first_posting_date DESC NULLS LAST, call_no
  `;

  return { sql, params };
}

/** Defective Generation docs. Used when filtering/sorting SAP Doc (Defective). */
export const CALL_PARTS_SAP_CTE = `
  sap_docs AS MATERIALIZED (
    SELECT upper(btrim(r.item_text)) AS call_no,
           btrim(r.plant) AS plant,
           btrim(r.vendor) AS vendor,
           regexp_replace(btrim(r.material), '^0+', '') AS material,
           CASE
             WHEN upper(btrim(r.material_description)) LIKE 'MOTOR%' THEN 'MOTOR'
             WHEN upper(btrim(r.material_description)) LIKE 'COMPRESSOR%'
               OR upper(btrim(r.material_description)) LIKE 'COMPRESOR%' THEN 'COMPRESOR'
             ELSE ''
           END AS family,
           string_agg(DISTINCT NULLIF(btrim(r.material_document), ''), ', '
                      ORDER BY NULLIF(btrim(r.material_document), '')) AS docs,
           coalesce(sum(r.qty), 0) AS qty
    FROM mb51_aging_rows r
    WHERE r.import_id = (SELECT id FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1)
      AND btrim(r.movement_type) IN (${DEFECTIVE_GENERATION_MOVEMENT_SQL})
      AND r.material IN (${DEFECTIVE_MATERIALS_SQL})
      AND btrim(r.item_text) <> ''
    GROUP BY 1, 2, 3, 4, 5
  )
`;

/** Equality join only, so Postgres hash-joins the doc groups. Family match is in the aggregate. */
export const CALL_PARTS_SAP_ATTACH = `
  LEFT JOIN dim_offices sap_fr
    ON sap_fr.ncode::text = NULLIF(btrim(h.franchisee_code), '')
  LEFT JOIN sap_docs d
    ON d.call_no = upper(btrim(p.call_no))
   AND d.plant = COALESCE(substring(btrim(h.branch_name) FROM '^[0-9]+'), '')
   AND d.vendor = btrim(sap_fr.vsapvendorcode)
`;

const CALL_PARTS_SAP_MATCH = `
    d.material = regexp_replace(btrim(p.part_code), '^0+', '')
    OR (d.family = 'MOTOR' AND upper(btrim(part_cat.item_category)) = 'MOTOR')
    OR (d.family = 'COMPRESOR' AND upper(btrim(part_cat.item_category)) IN ('COMPRESOR', 'COMPRESSOR'))
`;

export const CALL_PARTS_SAP_AGG = `string_agg(DISTINCT NULLIF(btrim(d.docs), ''), ', ' ORDER BY NULLIF(btrim(d.docs), ''))
  FILTER (WHERE ${CALL_PARTS_SAP_MATCH})`;

export const CALL_PARTS_SAP_QTY_AGG = `sum(d.qty) FILTER (WHERE ${CALL_PARTS_SAP_MATCH})`;

/** Filter on the grouped defective SAP doc column. Pushes a contains param when needed. */
export function sapDocOuterSql(raw: string, params: unknown[]): string {
  const value = raw.trim();
  if (!value) return '';
  if (value === SAP_DOC_HAS) return 'sap_doc_defective IS NOT NULL';
  if (value === SAP_DOC_BLANK) return 'sap_doc_defective IS NULL';
  params.push(ilikeParam(value));
  return `sap_doc_defective ILIKE $${params.length} ESCAPE '\\'`;
}

/** Presence / contains match for post-lookup SAP doc fields (consumption, receipt). */
export function matchesSapDocFilter(value: string | null | undefined, raw: string): boolean {
  const filter = raw.trim();
  if (!filter) return true;
  const v = (value ?? '').trim();
  if (filter === SAP_DOC_HAS) return v !== '';
  if (filter === SAP_DOC_BLANK) return v === '';
  return v.toLowerCase().includes(filter.toLowerCase());
}

export const CALL_PARTS_HOT_COLS = `
  h.logged_at AS call_logged_at,
  NULLIF(btrim(h.serial), '') AS barcode,
  NULLIF(btrim(h.item_name), '') AS machine_name,
  ${CALL_PARTS_MODEL} AS model_code,
  ${CALL_PARTS_PLANT} AS plant_name,
  ${CALL_PARTS_BRANCH} AS branch_name,
  ${CALL_PARTS_CLIENT} AS client_name,
  ${CALL_PARTS_CUSTOMER} AS party_name,
  NULLIF(btrim(h.city), '') AS city,
  ${CALL_PARTS_STATUS} AS status_label,
  ${CALL_PARTS_ENGINEER} AS engineer_name,
  h.call_type
`;

export function buildCallPartsFilterSql(filters: CallPartsFilterInput): CallPartsFilterSql {
  const params: unknown[] = [];
  const parts: string[] = [`h.call_type = 'BREAKDOWN'`];

  if (!filters.allTime) {
    params.push(filters.startDate, filters.endDate);
    const start = params.length - 1;
    const end = params.length;
    parts.push(
      `h.logged_at >= ($${start}::timestamp AT TIME ZONE 'Asia/Kolkata') AND h.logged_at < (($${end}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`
    );
  }

  const search = filters.search.trim();
  if (search) {
    params.push(ilikeParam(search));
    const n = params.length;
    parts.push(
      `(p.call_no ILIKE $${n} ESCAPE '\\' OR p.part_name ILIKE $${n} ESCAPE '\\' OR p.part_code ILIKE $${n} ESCAPE '\\' OR p.old_barcode ILIKE $${n} ESCAPE '\\' OR p.new_barcode ILIKE $${n} ESCAPE '\\' OR ${CALL_PARTS_CUSTOMER} ILIKE $${n} ESCAPE '\\')`
    );
  }

  const exact = (expr: string, raw: string) => {
    const value = raw.trim();
    if (!value) return;
    params.push(value.toUpperCase());
    parts.push(`upper(${expr}) = $${params.length}`);
  };
  exact(CALL_PARTS_PLANT, filters.plant);
  exact(CALL_PARTS_BRANCH, filters.branch);
  exact(CALL_PARTS_CLIENT, filters.client);
  exact(CALL_PARTS_ENGINEER, filters.engineer);
  exact(CALL_PARTS_STATUS, filters.status);
  exact(CALL_PARTS_CATEGORY, filters.category);

  const customer = filters.customer.trim();
  if (customer) {
    params.push(ilikeParam(customer));
    parts.push(`${CALL_PARTS_CUSTOMER} ILIKE $${params.length} ESCAPE '\\'`);
  }

  const part = filters.part.trim();
  if (part) {
    params.push(ilikeParam(part));
    const n = params.length;
    parts.push(`(p.part_name ILIKE $${n} ESCAPE '\\' OR p.part_code ILIKE $${n} ESCAPE '\\')`);
  }

  if (shouldRestrictToAssignedOffices(filters.isHod, filters.assignedOffices)) {
    params.push(filters.assignedOffices.map((id) => id.trim()).filter(Boolean));
    const n = params.length;
    parts.push(`(p.nofficeid = ANY($${n}::text[]) OR p.office_under = ANY($${n}::text[]))`);
  }

  return { where: parts.length ? parts.join(' AND ') : 'TRUE', params };
}
