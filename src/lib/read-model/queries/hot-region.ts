/**
 * Resolve display/export region when calls_latest_hot.region is blank.
 * Matches CRM trhcalls logic: zone from branch office (or parent when franchisee).
 */
export const HOT_OFFICE_JOINS_SQL = `
  LEFT JOIN dim_offices d_reg ON d_reg.ncode = h.nofficeid
  LEFT JOIN dim_offices dp_reg ON dp_reg.ncode = d_reg.nunder AND COALESCE(d_reg.nunder, 0) <> 0
`;

const OFFICE_ZONE_CODE_SQL = `
  COALESCE(
    CASE WHEN COALESCE(d_reg.nunder, 0) = 0 THEN d_reg.nzone ELSE dp_reg.nzone END,
    0
  )
`;

export const HOT_OFFICE_ZONE_NAME_SQL = `
  CASE ${OFFICE_ZONE_CODE_SQL}
    WHEN 1 THEN 'WEST ZONE'
    WHEN 2 THEN 'NORTH ZONE'
    WHEN 3 THEN 'EAST ZONE'
    WHEN 4 THEN 'SOUTH ZONE'
    ELSE 'OTHER'
  END
`;

/** Prefer stored region; fall back to office zone (same as live CRM export). */
export const HOT_RESOLVED_REGION_SQL = `
  COALESCE(NULLIF(trim(h.region), ''), ${HOT_OFFICE_ZONE_NAME_SQL})
`;

/** WRL branch office name pattern (e.g. "1173 - DELHI BRANCH"). */
export const HOT_OFFICE_IS_BRANCH_NAME_SQL = `
  (
    trim(COALESCE(d.vcompanyname, '')) ~* '\\mBRANCH\\M'
    OR trim(COALESCE(d.vcompanyname, '')) ~ '^\\d+\\s*-'
  )
`;

/** Franchisee → parent branch id; WRL branch office → self (not regional parent). */
export const HOT_MAIN_BRANCH_OFFICE_ID_SQL = `
  CASE
    WHEN ${HOT_OFFICE_IS_BRANCH_NAME_SQL} THEN h.nofficeid
    WHEN COALESCE(d.nunder, 0) <> 0 THEN d.nunder
    ELSE h.nofficeid
  END
`;

/** Summary branch label: hot branch_name / WRL branch office — never region or franchisee ASP. */
export const HOT_MAIN_BRANCH_NAME_SQL = `
  COALESCE(
    NULLIF(trim(h.branch_name), ''),
    CASE WHEN ${HOT_OFFICE_IS_BRANCH_NAME_SQL} THEN NULLIF(trim(d.vcompanyname), '') END,
    CASE
      WHEN trim(COALESCE(dp_reg.vcompanyname, '')) ~* '\\mBRANCH\\M'
        OR trim(COALESCE(dp_reg.vcompanyname, '')) ~ '^\\d+\\s*-'
      THEN NULLIF(trim(dp_reg.vcompanyname), '')
    END,
    NULLIF(trim(d.vcompanyname), ''),
    'UNKNOWN'
  )
`;
