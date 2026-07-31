import {
  WARRANTY_MASTER_HAS_CUSTOMER_SQL,
  WARRANTY_MASTER_HAS_PARTY_NAME_SQL,
  WARRANTY_MASTER_NOT_RETURNED_SQL,
} from '@/modules/warranty/services/constants';
import type { WarrantyMasterQueryParams } from '@/modules/warranty/services/types';
import { WARR_END_DT_EXPR, WARR_START_DT_EXPR, WARRANTY_MONTHS_EXPR } from './expressions';
import { appendDateBound, appendInFilter, escapeSql, splitCsvParam } from './helpers';

function appendWarrantyMonthsFilter(condition: string, params: WarrantyMasterQueryParams): string {
  const discrete = splitCsvParam(params.warrantyMonths).filter((v) => /^-?\d+$/.test(v));
  if (discrete.length > 0) {
    const list = discrete.join(',');
    return `${condition} AND (${WARRANTY_MONTHS_EXPR}) IN (${list})`;
  }
  const min = params.warrantyMonthsMin?.trim();
  const max = params.warrantyMonthsMax?.trim();
  let next = condition;
  if (min && /^-?\d+$/.test(min)) {
    next += ` AND (${WARRANTY_MONTHS_EXPR}) >= ${Number(min)}`;
  }
  if (max && /^-?\d+$/.test(max)) {
    next += ` AND (${WARRANTY_MONTHS_EXPR}) <= ${Number(max)}`;
  }
  return next;
}

export function buildWarrantyMasterWhereClause(params: WarrantyMasterQueryParams): string {
  let condition = `WHERE ${WARRANTY_MASTER_NOT_RETURNED_SQL}`;
  condition += ` AND ${WARRANTY_MASTER_HAS_CUSTOMER_SQL}`;
  condition += ` AND ${WARRANTY_MASTER_HAS_PARTY_NAME_SQL}`;
  condition = appendInFilter(condition, 'po.npartyprofile', params.customer);
  condition = appendInFilter(condition, 'mi.nitemtype', params.group);
  condition = appendInFilter(condition, 'mi.vitemcode', params.fgModel);
  condition = appendWarrantyMonthsFilter(condition, params);
  condition = appendDateBound(condition, WARR_START_DT_EXPR, params.warrStartFrom, params.warrStartTo);
  condition = appendDateBound(condition, WARR_END_DT_EXPR, params.warrEndFrom, params.warrEndTo);
  if (params.activeOnly) {
    condition += ` AND ${WARR_END_DT_EXPR} >= CAST(GETDATE() AS DATE)`;
  }
  const q = params.q?.trim();
  if (q) {
    const safe = escapeSql(q);
    condition += ` AND (pp.vname LIKE '%${safe}%' OR mi.vitemcode LIKE '%${safe}%')`;
  }
  return condition;
}
