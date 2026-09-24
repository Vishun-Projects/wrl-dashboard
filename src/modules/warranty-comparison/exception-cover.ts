export type ExceptionWorkDoneMode = 'none' | 'selected' | 'any';

export type ExceptionCoverAccount = {
  systemAccount: string;
  amc: boolean;
  amcValidUpto: string | null;
  compressorWarrantyMonths: number | null;
  workDoneMode: ExceptionWorkDoneMode;
};

export function addCalendarMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

export function isAmcCovered(callDate: string, account: ExceptionCoverAccount): boolean {
  return Boolean(account.amc && account.amcValidUpto && callDate <= account.amcValidUpto);
}

export function isCompressorWindow(
  callDate: string,
  warrStartDt: string | null,
  months: number | null
): boolean {
  if (!warrStartDt || months == null || months <= 0) return false;
  return callDate <= addCalendarMonths(warrStartDt, months);
}

/** AMC wins when both apply. */
export function coverageReason(
  callDate: string,
  warrStartDt: string | null,
  account: ExceptionCoverAccount,
  workDoneMatched: boolean
): 'AMC' | 'Compressor' | null {
  if (isAmcCovered(callDate, account)) return 'AMC';
  if (
    account.workDoneMode !== 'none' &&
    workDoneMatched &&
    isCompressorWindow(callDate, warrStartDt, account.compressorWarrantyMonths)
  ) {
    return 'Compressor';
  }
  return null;
}
