import { prisma } from '@/lib/db/prisma';
import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';

/**
 * null = unrestricted.
 * Otherwise every dim_offices.ncode under the user's assigned offices (self + children via nunder).
 */
export async function resolveAllowedAttendanceOfficeIds(
  isHod: boolean,
  assignedOffices: string[]
): Promise<number[] | null> {
  if (!shouldRestrictToAssignedOffices(isHod, assignedOffices)) return null;

  const ids = assignedOffices.map(Number).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return [];

  const rows = (await prisma.$queryRawUnsafe(
    `
    SELECT ncode::bigint AS ncode
    FROM dim_offices
    WHERE ncode = ANY($1::bigint[]) OR nunder = ANY($1::bigint[])
    `,
    ids
  )) as Array<{ ncode: number | string }>;

  return rows
    .map((r) => Number(r.ncode))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

/** Intersect client office filter with allowed set; empty client + restricted ⇒ all allowed. */
export function scopeAttendanceOfficeIds(
  requested: number[],
  allowed: number[] | null
): number[] {
  if (allowed == null) return requested;
  if (requested.length === 0) return allowed;
  const allow = new Set(allowed);
  return requested.filter((id) => allow.has(id));
}
