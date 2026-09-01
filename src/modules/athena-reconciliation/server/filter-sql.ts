import type { AthenaReconciliationFilterParams } from '@/modules/athena-reconciliation/types';

export type AthenaFilterSqlOptions = {
  omitField?: 'branch' | 'client' | 'callType' | 'failureReason';
  applyStatus?: boolean;
  includeSearch?: boolean;
  alias?: string;
};

export function toList(val?: string | string[] | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((v) => Boolean(v) && v !== 'All');
  if (val === 'All') return [];
  return [val];
}

/** Unregistered + legacy multiple-match rows (latter folded into unregistered in UI). */
export function unregisteredStatusSql(
  alias: string,
  hasTreat: boolean,
  treatParamIdx: number
): string {
  const status = `${alias}.reconciliation_status IN ('NOT_REGISTERED', 'MULTIPLE_MATCHES')`;
  if (!hasTreat) return `(${status})`;
  return `(${status} AND NOT EXISTS (SELECT 1 FROM unnest($${treatParamIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')))`;
}

export function buildAthenaFilterSql(
  params: AthenaReconciliationFilterParams,
  options: AthenaFilterSqlOptions = {}
): { conditions: string[]; values: unknown[]; whereClause: string } {
  const alias = options.alias ?? 'a';
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (params.startDate) {
    conditions.push(`${alias}.call_date >= $${paramIdx++}`);
    values.push(params.startDate);
  }
  if (params.endDate) {
    conditions.push(`${alias}.call_date <= $${paramIdx++}::date + interval '1 day'`);
    values.push(params.endDate);
  }

  const branchList = toList(params.branches);
  if (options.omitField !== 'branch' && branchList.length > 0) {
    conditions.push(`${alias}.branch_name = ANY($${paramIdx++}::text[])`);
    values.push(branchList);
  }

  const clientList = toList(params.clients);
  if (options.omitField !== 'client' && clientList.length > 0) {
    conditions.push(`${alias}.client_caption = ANY($${paramIdx++}::text[])`);
    values.push(clientList);
  }

  const callTypeList = toList(params.callTypes);
  if (options.omitField !== 'callType' && callTypeList.length > 0) {
    conditions.push(`${alias}.call_type = ANY($${paramIdx++}::text[])`);
    values.push(callTypeList);
  }

  const reasonList = toList(params.failureReasons);
  if (options.omitField !== 'failureReason' && reasonList.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM unnest($${paramIdx++}::text[]) AS r
      WHERE ${alias}.failure_reason = r
         OR ${alias}.failure_reason ILIKE (r || '%')
    )`);
    values.push(reasonList);
  }

  const excludedList = toList(params.excludedReasons);
  if (excludedList.length > 0) {
    conditions.push(`(${alias}.failure_reason IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest($${paramIdx++}::text[]) AS p
      WHERE ${alias}.failure_reason ILIKE (p || '%')
    ))`);
    values.push(excludedList);
  }

  if (options.applyStatus && params.status && params.status !== 'ALL') {
    const treatList = toList(params.treatAsRegisteredReasons);
    const hasTreat = treatList.length > 0;

    if (hasTreat) {
      const treatIdx = paramIdx++;
      values.push(treatList);

      if (params.status === 'REGISTERED') {
        conditions.push(
          `(${alias}.reconciliation_status = 'REGISTERED' OR EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')) )`
        );
      } else {
        const statusIdx = paramIdx++;
        values.push(params.status);
        conditions.push(
          `(${alias}.reconciliation_status = $${statusIdx} AND NOT EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')) )`
        );
      }
    } else {
      conditions.push(`${alias}.reconciliation_status = $${paramIdx++}`);
      values.push(params.status);
    }
  }

  if (options.includeSearch && params.search) {
    const term = `%${params.search.trim()}%`;
    conditions.push(`(
      ${alias}.serial_no ILIKE $${paramIdx}
      OR ${alias}.outlet_name ILIKE $${paramIdx}
      OR ${alias}.client_ticket_no ILIKE $${paramIdx}
      OR ${alias}.failure_reason ILIKE $${paramIdx}
      OR ${alias}.branch_name ILIKE $${paramIdx}
      OR ${alias}.client_caption ILIKE $${paramIdx}
      OR ${alias}.matched_vtrnno ILIKE $${paramIdx}
    )`);
    values.push(term);
    paramIdx++;
  }

  return { conditions, values, whereClause: conditions.join(' AND ') };
}
