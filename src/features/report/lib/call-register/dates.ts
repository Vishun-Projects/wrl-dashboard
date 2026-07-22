/** Client omits both dates for All Time; API must not re-default to current month. */
export function resolveCallRegisterDates(searchParams: URLSearchParams): {
  dateFrom?: string;
  dateTo?: string;
} {
  return {
    dateFrom: searchParams.get('dateFrom') || undefined,
    dateTo: searchParams.get('dateTo') || undefined,
  };
}

export function isCallRegisterAllTime(params: { dateFrom?: string; dateTo?: string }) {
  return !params.dateFrom && !params.dateTo;
}
