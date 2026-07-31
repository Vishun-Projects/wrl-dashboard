/** ncancelreason 2 = transfer; 0/null = none; any other code = real cancellation. */
export function isRealCancelReasonCode(reason: unknown): boolean {
  if (reason == null || reason === '') return false;
  const normalized = String(reason).trim();
  if (!normalized) return false;
  return normalized !== '0' && normalized !== '2';
}
