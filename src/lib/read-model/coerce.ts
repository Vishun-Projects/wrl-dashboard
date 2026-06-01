export function toBigInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).trim());
  if (Number.isNaN(n)) return null;
  return Math.trunc(n);
}
