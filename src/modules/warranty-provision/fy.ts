/**
 * Apr–Mar financial year + warranty coverage kernels (Excel SNAP formula).
 * Keep in sync with Postgres expressions in server/snap.ts.
 */

const DAY_MS = 86_400_000;

/** UTC calendar date → day number (days since 1970-01-01 UTC). */
export function toDayN(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error(`bad iso date: ${iso}`);
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}

export function fromDayN(n: number): string {
  const d = new Date(n * DAY_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** FY start calendar year: Apr 2026 → 2026; Mar 2026 → 2025. */
export function fyStartYear(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error(`bad iso date: ${iso}`);
  const y = +m[1];
  const month = +m[2];
  return month >= 4 ? y : y - 1;
}

export function fyLabel(startYear: number): string {
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return `${a}-${b}`;
}

export function fyStartIso(startYear: number): string {
  return `${startYear}-04-01`;
}

export function fyEndIso(startYear: number): string {
  return `${startYear + 1}-03-31`;
}

/** Excel-matching span (usually 364). */
export function fySpanDays(startYear: number): number {
  return toDayN(fyEndIso(startYear)) - toDayN(fyStartIso(startYear));
}

export function warrantyEndIso(startIso: string, days: number): string {
  return fromDayN(toDayN(startIso) + Math.round(days));
}

/**
 * Excel: IF(LEN(serial)=14, MID(serial,6,2)+2000, YEAR(invoiceDate))
 * MID is 1-based → JS substring(5, 7).
 */
export function mfgYearFromSerial(
  serial: string,
  invoiceIsoOrBillingYear: string | number | null
): number | null {
  const s = serial.trim();
  if (s.length === 14) {
    const yy = s.slice(5, 7);
    if (/^\d{2}$/.test(yy)) return 2000 + Number(yy);
  }
  if (typeof invoiceIsoOrBillingYear === 'number' && Number.isFinite(invoiceIsoOrBillingYear)) {
    return invoiceIsoOrBillingYear;
  }
  if (typeof invoiceIsoOrBillingYear === 'string') {
    const m = /^(\d{4})/.exec(invoiceIsoOrBillingYear.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Fractional coverage of one unit in one FY (unit-years).
 * Days=0 → 0; else MAX(0, (MIN(end, fyEnd) − MAX(asOf[, start], fyStart)) / (fyEnd − fyStart)).
 */
export function coverageFraction(opts: {
  asOf: string;
  fyStartYear: number;
  warrantyStart: string;
  warrantyEnd: string;
  days: number;
  strict?: boolean;
}): number {
  if (!opts.days || opts.days <= 0) return 0;
  const fs = toDayN(fyStartIso(opts.fyStartYear));
  const fe = toDayN(fyEndIso(opts.fyStartYear));
  const span = fe - fs;
  if (span <= 0) return 0;
  const asOf = toDayN(opts.asOf);
  const end = toDayN(opts.warrantyEnd);
  const start = toDayN(opts.warrantyStart);
  const lo = opts.strict ? Math.max(asOf, fs, start) : Math.max(asOf, fs);
  const hi = Math.min(end, fe);
  return Math.max(0, (hi - lo) / span);
}

export function remainingDays(warrantyEnd: string, asOf: string): number {
  return Math.max(0, toDayN(warrantyEnd) - toDayN(asOf));
}

export function warrantyStatus(warrantyEnd: string, asOf: string): 'Active' | 'Inactive' {
  return remainingDays(warrantyEnd, asOf) > 0 ? 'Active' : 'Inactive';
}

export function todayIsoIst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Prior calendar month in IST as `YYYY-MM` (default report period). */
export function prevPeriodYmIst(): string {
  const today = todayIsoIst();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

/** Accept `YYYY-MM` or `YYYY-MM-DD`; else prior IST month. */
export function parsePeriodYm(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  return prevPeriodYmIst();
}

export function monthStartIso(periodYm: string): string {
  const ym = parsePeriodYm(periodYm);
  return `${ym}-01`;
}

/**
 * Selected month → as-of for all calcs: first day of next month
 * (end of month + 1 day). Oct 2026 → 2026-11-01.
 */
export function asOfFromPeriodYm(periodYm: string): string {
  const ym = parsePeriodYm(periodYm);
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}
