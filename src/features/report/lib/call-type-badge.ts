/** CSS class for register-table call type badges (see globals.css). */
export function getCallTypeBadgeClass(callType: string | null | undefined): string {
  const normalized = String(callType || '').trim().toUpperCase();
  switch (normalized) {
    case 'BREAKDOWN':
      return 'badge-calltype-breakdown';
    case 'INSTALLATION CALL':
      return 'badge-calltype-installation';
    case 'DEPLOYMENT':
      return 'badge-calltype-deployment';
    default:
      return 'badge-calltype-default';
  }
}
