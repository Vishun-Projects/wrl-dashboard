export function formatCancelledCallFranchisee(
  vendorCode: string | null | undefined,
  name: string | null | undefined
): string {
  const code = String(vendorCode ?? '').trim();
  const label = String(name ?? '').trim();
  if (code && label) return `${code} - ${label}`;
  if (code) return code;
  return label || '—';
}
