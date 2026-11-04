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

export function isPracticeWinmaxOfficeName(name: string | undefined | null): boolean {
  if (!name) return false;
  return /practice|winmax|western\s+head\s+office\s*-\s*1100/i.test(name.trim());
}

/**
 * Cadbury/Mondelez + Coke/HCCB are import-replaced in unified MIS (open export /
 * account merge). Keep them on Key Account CRM rows; strip from branch rollups
 * so Branch-wise open/>7 cannot exceed Regional (Ranchi Cadbury dump).
 */
export function isImportReplacedCrmAccount(account: string | undefined | null): boolean {
  const key = String(account ?? '')
    .trim()
    .toLowerCase();
  return key === 'cadbury' || key === 'mondelez' || key === 'coke' || key === 'hccb';
}

/** Branch SQL only — do not apply to account summary queries. */
export const SUMMARY_EXCLUDE_IMPORT_REPLACED_ACCOUNT_SQL = `AND lower(trim(coalesce(h.account, ''))) NOT IN ('cadbury', 'mondelez', 'coke', 'hccb')`;
