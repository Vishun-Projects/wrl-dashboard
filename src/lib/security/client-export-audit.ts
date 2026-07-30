'use client';

export type ClientExportAuditInput = {
  action: 'report.export.start' | 'report.export.complete' | 'report.export.cancelled' | 'report.export.failure';
  result?: 'started' | 'completed' | 'cancelled' | 'failure' | 'success';
  reportName: string;
  format?: string;
  filename?: string;
  rowCount?: number;
  filters?: Record<string, unknown>;
  summary?: string;
  metadata?: Record<string, unknown>;
};

/** Fire-and-forget activity log for browser-built exports. */
export function logClientExportAction(input: ClientExportAuditInput): void {
  const result =
    input.result ??
    (input.action === 'report.export.start'
      ? 'started'
      : input.action === 'report.export.cancelled'
        ? 'cancelled'
        : input.action === 'report.export.failure'
          ? 'failure'
          : 'completed');

  void fetch('/api/security-audit/client-action', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, result }),
  }).catch(() => {
    /* best-effort */
  });
}
