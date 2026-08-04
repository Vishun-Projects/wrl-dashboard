/** CRM placeholders that must not count as real serials. */
const INVALID_SERIALS = new Set(['', '0', 'N/A', 'NA', 'NONE', 'NULL', '-', '—']);

export function normalizeSerial(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (INVALID_SERIALS.has(upper)) return null;
  return upper;
}
