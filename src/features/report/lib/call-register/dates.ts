/** Client omits both dates for All Time; API must not re-default to current month. */

export type CallRegisterDateField = 'imported' | 'billing';

/** Default is billing. `imported` remains for internal/API use only. */
export function parseCallRegisterDateField(raw: string | null | undefined): CallRegisterDateField {
  return raw === 'imported' ? 'imported' : 'billing';
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

export function callRegisterSerialExportFilename(
  params: { dateFrom?: string; dateTo?: string },
  date = new Date()
): string {
  const stamp = date.toISOString().slice(0, 10);
  if (isCallRegisterAllTime(params)) {
    return `WRL_Call_Register_Serials_AllTime_${stamp}.xlsx`;
  }
  return `WRL_Call_Register_Serials_${params.dateFrom}_${params.dateTo}.xlsx`;
}
