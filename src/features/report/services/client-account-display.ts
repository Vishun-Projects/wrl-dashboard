/**
 * Display aliases for client-import key accounts.
 * Internal merge keys stay cadbury/coke; UI and email body show Mondelez/HCCB.
 */

export function clientAccountDisplayName(account: string): string {
  const key = account.trim().toLowerCase();
  if (key === 'cadbury') return 'Mondelez';
  if (key === 'coke') return 'HCCB';
  return account.trim() || '—';
}

/** Match picker/body selections against raw keys or display aliases. */
export function accountsMatchDisplayOrKey(selected: string, account: string): boolean {
  const a = selected.trim().toLowerCase();
  const b = account.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const displayA = clientAccountDisplayName(selected).toLowerCase();
  const displayB = clientAccountDisplayName(account).toLowerCase();
  return displayA === displayB || a === displayB || displayA === b;
}
