/** Empty assignedOffices = national scope (all branches). */
export function seesAllOffices(isHod: boolean, assignedOffices: string[]): boolean {
  return isHod || assignedOffices.length === 0;
}

export function shouldRestrictToAssignedOffices(
  isHod: boolean,
  assignedOffices: string[]
): boolean {
  return !seesAllOffices(isHod, assignedOffices);
}

/** Restrict to assigned offices: call office or franchisee parent (nunder) under an assigned branch. */
export function appendOfficeSecurityFilter(
  condition: string,
  isHod: boolean,
  assignedOffices: string[],
  opts?: { officeCol?: string; underCol?: string }
): string {
  if (!shouldRestrictToAssignedOffices(isHod, assignedOffices)) return condition;

  const allowed = assignedOffices.join(',');
  const officeCol = opts?.officeCol ?? 'tc.nofficeid';
  const underCol = opts?.underCol ?? 'o.nunder';
  return `${condition} AND (${officeCol} IN (${allowed}) OR ${underCol} IN (${allowed}))`;
}

export function hasOfficeScope(isHod: boolean, assignedOffices: string[]): boolean {
  return seesAllOffices(isHod, assignedOffices) || assignedOffices.length > 0;
}

export function canAccessOffice(
  isHod: boolean,
  assignedOffices: string[],
  officeId: string | number | null | undefined
): boolean {
  if (seesAllOffices(isHod, assignedOffices)) return true;
  if (officeId == null) return false;
  return assignedOffices.includes(String(officeId));
}
