/** Office scoping SQL fragment for CRM trhcalls / ARCP queries. */
export function appendOfficeSecurityFilter(
  condition: string,
  isHod: boolean,
  assignedOffices: string[],
  opts?: { officeCol?: string; underCol?: string }
): string {
  if (isHod || assignedOffices.length === 0) return condition;
  const allowed = assignedOffices.join(',');
  const officeCol = opts?.officeCol ?? 'tc.nofficeid';
  const underCol = opts?.underCol ?? 'o.nunder';
  return `${condition} AND (${officeCol} IN (${allowed}) OR ${underCol} IN (${allowed}))`;
}
