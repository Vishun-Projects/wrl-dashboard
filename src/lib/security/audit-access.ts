const SECURITY_AUDIT_ALLOWED_EMAILS = new Set([
  'vishunvishwakarma90211@gmail.com',
  'vishnuvishwakarma90211@gmail.com',
  'vishnu.vishwakarma@westernequipments.com',
]);

export function canViewSecurityAudit(email: string | null | undefined): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  return SECURITY_AUDIT_ALLOWED_EMAILS.has(normalized);
}
