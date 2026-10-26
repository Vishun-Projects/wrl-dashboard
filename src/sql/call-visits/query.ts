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
