/**
 * Deployment Completion client scope.
 * - Curated CALL_REGISTER_CLIENTS: CRM sync allowlist + DB seed fallback.
 * - Shared visible list: DB table call_register_visible_clients (what everyone else sees).
 * - Full dynamic list / editors: emails in CALL_REGISTER_FULL_CLIENTS_EMAILS.
 */
export const CALL_REGISTER_CLIENTS = [
  'UB',
  'Nestle',
  'ABInBeV',
  'MARS',
  'Redbull',
  'Carlsberg',
  'Ferrero',
  'Reliance',
  'Reliance Campa Cola',
] as const;

export type CallRegisterClient = (typeof CALL_REGISTER_CLIENTS)[number];

/** Who can see the full dynamic account list + “Accounts visible” dropdown. Add emails here later. */
export const CALL_REGISTER_FULL_CLIENTS_EMAILS = [
  'vishunvishwakarma90211@gmail.com',
] as const;

export const CALL_REGISTER_FULL_CLIENTS_EMAIL = CALL_REGISTER_FULL_CLIENTS_EMAILS[0];

export function canSeeAllCallRegisterClients(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return (CALL_REGISTER_FULL_CLIENTS_EMAILS as readonly string[]).some(
    (allowed) => allowed.toLowerCase() === normalized
  );
}

export function isCallRegisterClient(value: string): value is CallRegisterClient {
  return (CALL_REGISTER_CLIENTS as readonly string[]).includes(value.trim());
}

/** Parse `clients=a,b,c` query param. */
export function parseCallRegisterClientList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Trim, collapse spaces, dedupe case-insensitively (first spelling wins). */
export function normalizeVisibleClientNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Validate export/serial client list for the viewer.
 * Normal users must be within `allowedClients` (shared DB allowlist).
 * Full-access editors may export any non-empty selection.
 */
export function validateCallRegisterExportClients(
  clients: string[],
  email: string | null | undefined,
  allowedClients: readonly string[] = CALL_REGISTER_CLIENTS
): { ok: true; clients: string[] } | { ok: false; error: string } {
  if (!clients.length) {
    return { ok: false, error: 'Select at least one account to export.' };
  }
  if (canSeeAllCallRegisterClients(email)) {
    return { ok: true, clients };
  }
  const allowed = new Set(allowedClients.map((c) => c.trim()).filter(Boolean));
  const invalid = clients.filter((c) => !allowed.has(c.trim()));
  if (invalid.length) {
    return { ok: false, error: 'One or more selected accounts are not allowed.' };
  }
  return { ok: true, clients };
}
