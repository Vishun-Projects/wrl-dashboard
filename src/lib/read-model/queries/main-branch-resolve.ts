import { looksLikeBranchOffice } from '@/lib/trhcalls/query';

/** Map a call row to its main WRL branch office id (parent when franchisee). */
export function resolveMainBranchOfficeId(row: Record<string, unknown>): number {
  const resolvedCode = Number(row.resolved_branch_code ?? 0);
  if (Number.isFinite(resolvedCode) && resolvedCode > 0) {
    return resolvedCode;
  }
  const officeId = Number(row.officeId ?? row.nofficeid ?? 0);
  const officeName = String(row.office_name ?? row.officename ?? '').trim();
  if (officeName && looksLikeBranchOffice(officeName)) {
    return officeId;
  }
  const parentId = Number(row.parentId ?? row.office_under ?? 0);
  return parentId > 0 ? parentId : officeId;
}

/** Map a call row to its main WRL branch display name. */
export function resolveMainBranchDisplayName(row: Record<string, unknown>): string {
  for (const key of ['resolved_branch_name', 'branch_name', 'resolved_branch', 'branch_office_name']) {
    const value = String(row[key] ?? '').trim();
    if (value && value !== 'UNKNOWN' && looksLikeBranchOffice(value)) {
      return value;
    }
  }
  for (const key of ['resolved_branch_name', 'branch_name', 'resolved_branch', 'branch_office_name']) {
    const value = String(row[key] ?? '').trim();
    if (value && value !== 'UNKNOWN') {
      return value;
    }
  }
  const officeName = String(row.office_name ?? row.officename ?? row.branch ?? '').trim();
  if (officeName && looksLikeBranchOffice(officeName)) {
    return officeName;
  }
  return officeName || 'UNKNOWN';
}
