const DEFAULT_ALLOWED_EMAIL_DOMAINS = ['westernequipments.com'] as const;

/** Normalize domain: strip leading @, lowercase, trim. */
export function normalizeEmailDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

export function normalizeAllowedEmailDomains(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ALLOWED_EMAIL_DOMAINS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const domain = normalizeEmailDomain(item);
    if (!domain || !domain.includes('.')) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out.length > 0 ? out : [...DEFAULT_ALLOWED_EMAIL_DOMAINS];
}

export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = normalizeEmailDomain(email.slice(at + 1));
  return domain || null;
}

export function isEmailAllowedForDomains(email: string, allowedDomains: string[]): boolean {
  const domain = emailDomainOf(email);
  if (!domain) return false;
  const allow = allowedDomains.map(normalizeEmailDomain).filter(Boolean);
  if (allow.length === 0) return false;
  return allow.includes(domain);
}

export function assertAllowedEmailDomains(
  emails: string[],
  allowedDomains: string[] = [...DEFAULT_ALLOWED_EMAIL_DOMAINS]
): void {
  const allow = normalizeAllowedEmailDomains(allowedDomains);
  const rejected = emails
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .filter((email) => !isEmailAllowedForDomains(email, allow));
  if (rejected.length === 0) return;
  const domainsLabel = allow.map((d) => `@${d}`).join(', ');
  throw new Error(
    `Only ${domainsLabel} addresses are allowed (rejected: ${rejected.join(', ')})`
  );
}
