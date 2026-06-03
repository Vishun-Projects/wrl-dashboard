/**
 * Normalize API / internal error text before showing in toasts or UI.
 */
export function sanitizeUserFacingMessage(message: string): string {
  if (!message) return message;
  let text = message.trim();

  const replacements: [RegExp, string][] = [
    [/SYNC_WORKER_ENABLED is not true[^\n]*/gi, 'Background refresh is temporarily unavailable'],
    [/CRM database/gi, 'Server'],
    [/live CRM/gi, 'additional sources'],
    [/from CRM/gi, 'from backup'],
    [/CRM query/gi, 'Query'],
    [/CRM timed out/gi, 'Request timed out'],
    [/CRM viewstate OOM[^\n]*/gi, 'Date range too large — choose a shorter range'],
    [/viewstate OOM[^\n]*/gi, 'Date range too large — choose a shorter range'],
    [/result grid too large[^\n]*/gi, 'Date range too large — choose a shorter range'],
    [/statement timeout/gi, 'Query took too long — try a shorter date range or retry'],
    [/canceling statement due to statement timeout/gi, 'Query took too long — try a shorter date range or retry'],
    [/Connection terminated[^\n]*/gi, 'Database connection lost — please retry'],
    [/CRM/gi, ''],
    [/Postgres reload/gi, 'reload'],
    [/Postgres/gi, 'cache'],
    [/postgres/gi, 'cache'],
    [/incremental sync/gi, 'update'],
    [/report corpus/gi, 'report data'],
    [/Corpus load failed/gi, 'Report data load failed'],
    [/Corpus query failed/gi, 'Report data load failed'],
    [/Failed to load report corpus/gi, 'Failed to load report data'],
    [/pincode fraud/gi, 'pincode mismatch'],
    [/\bfraud\b/gi, 'mismatch'],
    [/ARCP Postgres read model is not ready/gi, 'ARCP claims data is not ready yet'],
    [/ARCP backfill has not completed[^\n]*/gi, 'ARCP claims data is still loading — try again later'],
    [/arcp_lines_hot is empty[^\n]*/gi, 'ARCP claims cache is empty — contact your administrator'],
    [/npm run sync-worker[^\n]*/gi, 'contact your administrator'],
    [/read model/gi, 'cached data'],
    [/\bvlatlong\b/gi, 'web capture'],
    [/\bmlatlong\b/gi, 'mobile capture'],
    [/\s{2,}/g, ' '],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text.trim();
}

export function toUserFacingError(err: unknown): string {
  if (err instanceof Error) return sanitizeUserFacingMessage(err.message);
  if (typeof err === 'string') return sanitizeUserFacingMessage(err);
  return sanitizeUserFacingMessage('Something went wrong');
}
