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
