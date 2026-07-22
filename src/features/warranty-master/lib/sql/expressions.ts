/** CRM column expressions for warranty date parsing and derived fields. */

export const WARR_START_DT_EXPR = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(po.dwarrstartdate AS VARCHAR(30)))), ''), 103)`;

export const WARR_END_DT_EXPR = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(po.dwarrenddate AS VARCHAR(30)))), ''), 103)`;

export const WARRANTY_MONTHS_EXPR = `DATEDIFF(month, ${WARR_START_DT_EXPR}, ${WARR_END_DT_EXPR})`;

export const CUSTOMER_NAME_EXPR = `LTRIM(RTRIM(pp.vname))`;

export const GROUP_NAME_EXPR = `ISNULL(it.vname, '(Unknown)')`;

export const FG_MODEL_EXPR = `ISNULL(NULLIF(LTRIM(RTRIM(mi.vitemcode)), ''), '(No model)')`;
