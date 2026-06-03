import { WARRANTY_MASTER_BASE_FROM } from '../constants';
import type { WarrantyMasterQueryParams, WarrantyMasterRowDetailParams } from '../types';
import {
  CUSTOMER_NAME_EXPR,
  FG_MODEL_EXPR,
  GROUP_NAME_EXPR,
  WARR_END_DT_EXPR,
  WARR_START_DT_EXPR,
  WARRANTY_MONTHS_EXPR,
} from './expressions';
import { escapeSql } from './helpers';
import { buildWarrantyMasterWhereClause } from './where-clause';

function appendRowIdentityMatch(
  detail: Pick<WarrantyMasterRowDetailParams, 'customerKey' | 'customerName' | 'groupKey' | 'groupName'>
): string {
  const customerKey = detail.customerKey?.trim();
  const groupKey = detail.groupKey?.trim();
  const customerName = escapeSql(detail.customerName?.trim() ?? '');
  const groupName = escapeSql(detail.groupName?.trim() ?? '(Unknown)');

  let rowMatch = '';
  if (customerKey) {
    rowMatch += ` AND CAST(po.npartyprofile AS NVARCHAR(50)) = '${escapeSql(customerKey)}'`;
  } else if (customerName) {
    rowMatch += ` AND ${CUSTOMER_NAME_EXPR} = '${customerName}'`;
  }
  if (groupKey) {
    rowMatch += ` AND CAST(mi.nitemtype AS NVARCHAR(50)) = '${escapeSql(groupKey)}'`;
  } else {
    rowMatch += ` AND ${GROUP_NAME_EXPR} = '${groupName}'`;
  }
  return rowMatch;
}

/** Aggregated rows (server CSV export / legacy API mode). */
export function buildWarrantyMasterAggregateSql(params: WarrantyMasterQueryParams): string {
  const where = buildWarrantyMasterWhereClause(params);
  return `
    SELECT
      customerName,
      groupName,
      customerKey,
      groupKey,
      warrantyMonths,
      COUNT(*) AS machineCount
    FROM (
      SELECT
        ${CUSTOMER_NAME_EXPR} AS customerName,
        ${GROUP_NAME_EXPR} AS groupName,
        CAST(po.npartyprofile AS NVARCHAR(50)) AS customerKey,
        CAST(mi.nitemtype AS NVARCHAR(50)) AS groupKey,
        ${WARRANTY_MONTHS_EXPR} AS warrantyMonths,
        po.ncode AS ncode
      ${WARRANTY_MASTER_BASE_FROM}
      ${where}
    ) base
    WHERE warrantyMonths IS NOT NULL
    GROUP BY customerName, groupName, customerKey, groupKey, warrantyMonths
    ORDER BY customerName, groupName, CAST(warrantyMonths AS INT)
  `;
}

/** Full dataset at FG-model granularity — fetch once, filter on the client. */
export function buildWarrantyMasterFgLinesSql(): string {
  const where = buildWarrantyMasterWhereClause({});
  return `
    SELECT
      customerName,
      groupName,
      customerKey,
      groupKey,
      warrantyMonths,
      fgModel,
      COUNT(*) AS machineCount,
      SUM(CASE WHEN warrEndDt >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS activeMachineCount,
      CONVERT(VARCHAR(10), MIN(warrEndDt), 23) AS minWarrEnd,
      CONVERT(VARCHAR(10), MAX(warrEndDt), 23) AS maxWarrEnd
    FROM (
      SELECT
        ${CUSTOMER_NAME_EXPR} AS customerName,
        ${GROUP_NAME_EXPR} AS groupName,
        CAST(po.npartyprofile AS NVARCHAR(50)) AS customerKey,
        CAST(mi.nitemtype AS NVARCHAR(50)) AS groupKey,
        ${WARRANTY_MONTHS_EXPR} AS warrantyMonths,
        ${FG_MODEL_EXPR} AS fgModel,
        ${WARR_END_DT_EXPR} AS warrEndDt
      ${WARRANTY_MASTER_BASE_FROM}
      ${where}
    ) base
    WHERE warrantyMonths IS NOT NULL
    GROUP BY customerName, groupName, customerKey, groupKey, warrantyMonths, fgModel
    ORDER BY customerName, groupName, CAST(warrantyMonths AS INT), fgModel
  `;
}

/** Row expand detail (legacy API — UI uses cached fg lines instead). */
export function buildWarrantyMasterRowDetailSql(detail: WarrantyMasterRowDetailParams): string {
  const where = buildWarrantyMasterWhereClause(detail);
  const months = Number(detail.rowWarrantyMonths);
  if (!Number.isFinite(months)) {
    throw new Error('Invalid rowWarrantyMonths');
  }
  let rowMatch = appendRowIdentityMatch(detail);
  rowMatch += ` AND (${WARRANTY_MONTHS_EXPR}) = ${months}`;
  rowMatch += ` AND ${WARR_START_DT_EXPR} IS NOT NULL AND ${WARR_END_DT_EXPR} IS NOT NULL`;

  return `
    SELECT
      ${FG_MODEL_EXPR} AS fgModel,
      COUNT(*) AS machineCount
    ${WARRANTY_MASTER_BASE_FROM}
    ${where}
    ${rowMatch}
    GROUP BY mi.vitemcode
    ORDER BY machineCount DESC, fgModel
  `;
}
