export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function splitCsvParam(param: string | number | null | undefined): string[] {
  if (param == null || param === '') return [];
  if (typeof param === 'number') return [];
  const text = String(param);
  if (text === 'All' || text === 'undefined' || text === 'null') return [];
  return text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function appendInFilter(
  condition: string,
  column: string,
  param: string | null | undefined
): string {
  const values = splitCsvParam(param);
  if (values.length === 0) return condition;
  const list = values.map((v) => `'${escapeSql(v)}'`).join(',');
  return `${condition} AND ${column} IN (${list})`;
}

export function appendDateBound(
  condition: string,
  dateExpr: string,
  from: string | null | undefined,
  to: string | null | undefined
): string {
  let next = condition;
  if (from) {
    next += ` AND ${dateExpr} >= TRY_CONVERT(DATETIME, '${escapeSql(from)}', 23)`;
  }
  if (to) {
    next += ` AND ${dateExpr} < DATEADD(day, 1, TRY_CONVERT(DATETIME, '${escapeSql(to)}', 23))`;
  }
  return next;
}
