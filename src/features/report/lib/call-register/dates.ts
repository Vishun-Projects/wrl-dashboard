/** Client omits both dates for All Time; API must not re-default to current month. */

export type CallRegisterDateField = 'imported' | 'billing';

export function parseCallRegisterDateField(raw: string | null | undefined): CallRegisterDateField {
  return raw === 'billing' ? 'billing' : 'imported';
}

/** Postgres expression for the active date-range field. Pass alias e.g. `b`, or omit for bare columns. */
export function callRegisterDateSqlExpr(
  field: CallRegisterDateField,
  alias?: string
): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return field === 'billing'
    ? `COALESCE(${col('warranty_start')}, ${col('daddedon')})`
    : col('daddedon');
}

export function resolveCallRegisterDates(searchParams: URLSearchParams): {
  dateFrom?: string;
  dateTo?: string;
  dateField: CallRegisterDateField;
} {
  return {
    dateFrom: searchParams.get('dateFrom') || undefined,
    dateTo: searchParams.get('dateTo') || undefined,
    dateField: parseCallRegisterDateField(searchParams.get('dateField')),
  };
}

export function isCallRegisterAllTime(params: { dateFrom?: string; dateTo?: string }) {
  return !params.dateFrom && !params.dateTo;
}
