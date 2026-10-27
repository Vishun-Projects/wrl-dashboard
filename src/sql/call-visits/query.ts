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

export const SAP_DOC_HAS = '__has__';
export const SAP_DOC_BLANK = '__blank__';

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
