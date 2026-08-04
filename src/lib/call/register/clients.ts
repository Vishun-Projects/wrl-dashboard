/**
 * Deployment Completion client scope.
 * - Shared visible list: DB table call_register_visible_clients (what everyone else sees).
 * - Full dynamic list / editors: Super Admin (`super_admin` permission).
 * - CRM TransactionEntry sync: all clients from CRM (not gated here).
 */

import { isSuperAdmin } from '@/lib/auth/rbac-catalog';

export function canSeeAllCallRegisterClients(
  permissions: string[] | null | undefined
): boolean {
  return isSuperAdmin(permissions);
}

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
 * Super Admins may export any non-empty selection.
 */
export function validateCallRegisterExportClients(
  clients: string[],
  permissions: string[] | null | undefined,
  allowedClients: readonly string[] = []
): { ok: true; clients: string[] } | { ok: false; error: string } {
  if (!clients.length) {
    return { ok: false, error: 'Select at least one account to export.' };
  }
  if (canSeeAllCallRegisterClients(permissions)) {
    return { ok: true, clients };
  }
  const allowed = new Set(allowedClients.map((c) => c.trim()).filter(Boolean));
  const invalid = clients.filter((c) => !allowed.has(c.trim()));
  if (invalid.length) {
    return { ok: false, error: 'One or more selected accounts are not allowed.' };
  }
  return { ok: true, clients };
}
