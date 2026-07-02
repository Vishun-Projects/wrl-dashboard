/**
 * Exclude WinMax practice / training offices from MIS rollups and register.
 * Matches Excel BD MIS — practice offices are not production franchisees.
 */

export function excludePracticeWinmaxOfficeSql(officeAlias = 'd'): string {
  return `AND COALESCE(${officeAlias}.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'`;
}

/** Requires `dim_offices d` joined on `d.ncode = h.nofficeid`. */
export const SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL = excludePracticeWinmaxOfficeSql('d');

/** Requires `HOT_OFFICE_JOINS_SQL` (`d_reg` alias). */
export const REGISTER_EXCLUDE_PRACTICE_OFFICE_SQL = excludePracticeWinmaxOfficeSql('d_reg');

export function isPracticeWinmaxOfficeName(name: string): boolean {
  return /practice|winmax/i.test(name.trim());
}
