/** Office scoping SQL fragment for CRM trhcalls / ARCP queries. */
export function appendOfficeSecurityFilter(
  condition: string,
  isHod: boolean,
  assignedOffices: string[],
  opts?: { officeCol?: string; underCol?: string }
): string {
  if (isHod) return condition;
  if (assignedOffices.length === 0) return `${condition} AND 1=0`;

  const allowed = assignedOffices.join(',');
  const officeCol = opts?.officeCol ?? 'tc.nofficeid';
  const underCol = opts?.underCol ?? 'o.nunder';
  return `${condition} AND (${officeCol} IN (${allowed}) OR ${underCol} IN (${allowed}))`;
}

export function hasOfficeScope(isHod: boolean, assignedOffices: string[]): boolean {
  return isHod || assignedOffices.length > 0;
}

export function canAccessOffice(
  isHod: boolean,
  assignedOffices: string[],
  officeId: string | number | null | undefined
): boolean {
  if (isHod) return true;
  if (assignedOffices.length === 0 || officeId == null) return false;
  return assignedOffices.includes(String(officeId));
}
