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
    [/CRM/gi, ''],
    [/Postgres reload/gi, 'reload'],
    [/Postgres/gi, 'cache'],
    [/postgres/gi, 'cache'],
    [/incremental sync/gi, 'update'],
    [/report corpus/gi, 'report data'],
    [/Corpus load failed/gi, 'Report data load failed'],
    [/Corpus query failed/gi, 'Report data load failed'],
    [/Failed to load report corpus/gi, 'Failed to load report data'],
    [/\s{2,}/g, ' '],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text.trim();
}
