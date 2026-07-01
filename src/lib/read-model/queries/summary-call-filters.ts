/**
 * Exclude WinMax practice / training offices from MIS summary rollups.
 * Matches Excel BD MIS — practice offices are not production franchisees.
 */

/** Requires `dim_offices d` joined on `d.ncode = h.nofficeid`. */
export const SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL = `
  AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'
`;

export function isPracticeWinmaxOfficeName(name: string): boolean {
  return /practice|winmax/i.test(name.trim());
}
