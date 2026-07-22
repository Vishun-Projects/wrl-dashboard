import {
  hasCapability,
  LEGACY_HOD_ROLE_NAMES,
  seesAllOfficesForUser,
} from '@/lib/auth/rbac-catalog';
import { withAppClient } from '@/lib/read-model/db';
import type { DigestRecipient } from '@/features/mis-email/lib/recipients';

export type UserDigestScope = {
  isHod: boolean;
  assignedOffices: string[];
  scopeLabel: string;
};

function isHodForDigest(role: string, permissions: string[]): boolean {
  return (
    hasCapability(permissions, 'view_all_offices') ||
    (LEGACY_HOD_ROLE_NAMES as readonly string[]).includes(role)
  );
}

export function resolveUserDigestScope(recipient: DigestRecipient): Omit<UserDigestScope, 'scopeLabel'> & {
  seesAll: boolean;
} {
  const isHod = isHodForDigest(recipient.role, recipient.permissions);
  const assignedOffices = recipient.office_ids.map(String);
  const seesAll = seesAllOfficesForUser(recipient.permissions, recipient.role, assignedOffices);

  return {
    isHod,
    assignedOffices,
    seesAll,
  };
}

async function formatBranchScopeLabel(officeIds: string[]): Promise<string> {
  if (officeIds.length === 0) return 'All branches';

  const rows = await withAppClient(async (client) => {
    const res = await client.query<{ ncode: number; vcompanyname: string | null }>(
      `SELECT ncode, vcompanyname FROM dim_offices WHERE ncode = ANY($1::bigint[]) ORDER BY vcompanyname ASC`,
      [officeIds.map((id) => Number(id))]
    );
    return res.rows;
  });

  const names = rows
    .map((r) => r.vcompanyname?.trim() || String(r.ncode))
    .filter(Boolean);

  if (names.length === 0) {
    return `Branches: ${officeIds.join(', ')}`;
  }
  const MAX_BRANCH_NAMES_IN_SCOPE_LABEL = 3;
  if (names.length <= MAX_BRANCH_NAMES_IN_SCOPE_LABEL) {
    return `Branches: ${names.join(', ')}`;
  }
  const visible = names.slice(0, MAX_BRANCH_NAMES_IN_SCOPE_LABEL).join(', ');
  const hiddenCount = names.length - MAX_BRANCH_NAMES_IN_SCOPE_LABEL;
  return `Branches: ${visible} +${hiddenCount} more`;
}

export async function resolveUserDigestScopeWithLabel(
  recipient: DigestRecipient
): Promise<UserDigestScope> {
  const base = resolveUserDigestScope(recipient);

  if (base.seesAll) {
    return {
      isHod: base.isHod,
      assignedOffices: base.assignedOffices,
      scopeLabel: 'All branches',
    };
  }

  const scopeLabel = await formatBranchScopeLabel(base.assignedOffices);
  return {
    isHod: base.isHod,
    assignedOffices: base.assignedOffices,
    scopeLabel,
  };
}
