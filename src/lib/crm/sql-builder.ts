import 'server-only';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whitelist numeric IDs for CRM SQL fragments. */
export function assertNumericId(value: string | number | null | undefined, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${field}`);
  }
  return Math.trunc(n);
}

export function assertNumericIdList(values: string, field: string): string {
  const parts = values
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid ${field}`);
  }
  return parts.map((p) => String(assertNumericId(p, field))).join(',');
}

/** Escape ISO date strings for CRM SQL literals. */
export function assertIsoDate(value: string | null | undefined, field: string): string {
  const trimmed = (value ?? '').trim();
  if (!ISO_DATE.test(trimmed)) {
    throw new Error(`Invalid ${field} date`);
  }
  return trimmed;
}

export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function sqlDateLiteral(value: string): string {
  return `'${escapeSqlLiteral(assertIsoDate(value, 'date'))}'`;
}

export function sqlDateTimeEndLiteral(value: string): string {
  return `'${escapeSqlLiteral(assertIsoDate(value, 'date'))} 23:59:59'`;
}

/** Reject unexpected raw SQL injection in caller-provided fragments. */
export function assertSafeSqlFragment(fragment: string, label: string): string {
  const lower = fragment.toLowerCase();
  if (
    lower.includes(';') ||
    lower.includes('--') ||
    lower.includes('/*') ||
    /\b(drop|delete|insert|update|exec|execute|union)\b/.test(lower)
  ) {
    throw new Error(`Unsafe SQL fragment: ${label}`);
  }
  return fragment;
}
