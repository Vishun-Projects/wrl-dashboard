/** Shared CRM filter fragments for Warranty Master SQL. */

/** Non-returned machines only — returned units are off warranty master. */
export const WARRANTY_MASTER_NOT_RETURNED_SQL = `(
  po.breturned = 'False' OR po.breturned = '0' OR po.breturned IS NULL OR po.breturned = 0
)`;

/** Machines without a party profile code are excluded. */
export const WARRANTY_MASTER_HAS_CUSTOMER_SQL = `(
  NULLIF(LTRIM(RTRIM(CAST(po.npartyprofile AS VARCHAR(50)))), '') IS NOT NULL
)`;

/** Exclude machines whose party profile has no resolved name (do not fall back to profile code). */
export const WARRANTY_MASTER_HAS_PARTY_NAME_SQL = `(
  NULLIF(LTRIM(RTRIM(pp.vname)), '') IS NOT NULL
)`;

export const WARRANTY_MASTER_BASE_FROM = `
  FROM mstprorg po (NOLOCK)
  LEFT JOIN mstpartyprofile pp (NOLOCK) ON po.npartyprofile = pp.ncode
  LEFT JOIN mstitems mi (NOLOCK) ON po.nitem = mi.ncode
  LEFT JOIN mstitemtype it (NOLOCK) ON mi.nitemtype = it.ncode
`;
