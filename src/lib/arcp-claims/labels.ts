/** True when a label is only a CRM ncode (needs lookup). */
export function isBareNumericArcpLabel(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/** Display name for export/UI; resolves numeric codes via lookup when provided. */
export function resolveArcpItemCategoryDisplay(
  value: string,
  labelsByCode?: Record<string, string>
): string {
  const trimmed = value.trim();
  if (trimmed && !isBareNumericArcpLabel(trimmed)) return trimmed;
  const code = trimmed;
  const fromCode = labelsByCode?.[code];
  if (fromCode && !isBareNumericArcpLabel(fromCode)) return fromCode;
  return trimmed || code;
}
