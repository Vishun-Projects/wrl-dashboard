/**
 * Exclude non-production offices from MIS rollups and register.
 * Includes WinMax practice/training offices and Western Head Office test branch.
 */

export function excludePracticeWinmaxOfficeSql(officeAlias = 'd'): string {
  return `AND COALESCE(${officeAlias}.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`;
}

/** Requires `dim_offices d` joined on `d.ncode = h.nofficeid`. */
export const SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL = excludePracticeWinmaxOfficeSql('d');

/** Requires `HOT_OFFICE_JOINS_SQL` (`d_reg` alias). */
export const REGISTER_EXCLUDE_PRACTICE_OFFICE_SQL = excludePracticeWinmaxOfficeSql('d_reg');

export function isPracticeWinmaxOfficeName(name: string): boolean {
  return /practice|winmax|western\s+head\s+office\s*-\s*1100/i.test(name.trim());
}
