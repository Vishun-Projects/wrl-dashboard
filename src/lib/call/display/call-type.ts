export function normalizeCallTypeDisplay(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function parseCallTypesParam(callTypesParam?: string | null): string[] | null {
  if (!callTypesParam || callTypesParam === 'All' || callTypesParam === 'undefined' || callTypesParam === 'null') {
    return null;
  }
  const types = callTypesParam.split(',').map((s) => s.trim()).filter(Boolean);
  return types.length > 0 ? types : null;
}

/** Client-side filter — mirrors appendCallTypeFilter (exact display label match). */
export function matchesCallTypeFilter(
  row: Record<string, unknown>,
  callTypesParam?: string | null
): boolean {
  const allowed = parseCallTypesParam(callTypesParam);
  if (!allowed) return true;
  const callType = normalizeCallTypeDisplay(row.calltype);
  if (!callType) return false;
  return allowed.some((t) => normalizeCallTypeDisplay(t) === callType);
}
