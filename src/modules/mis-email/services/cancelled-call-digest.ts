import {
  buildCancelledCallsCsv,
  fetchCancelledCallsForDigestDay,
  istYesterdayYmd,
} from '@/modules/cancelled-calls';
import {
  ensureCancelledCallDigestTables,
  listEnabledCancelledDigestEmailsForBranch,
  recordCancelledDigestSent,
  wasCancelledDigestAlreadySent,
} from '@/modules/mis-email/server/sync/cancelled-call-digest-recipients';
import { sendPreparedDigestEmail } from '@/modules/mis-email/services/send';
import type { CancelledCallRow } from '@/modules/cancelled-calls/types';

export type CancelledCallDigestResult = {
  digestDate: string;
  sent: Array<{ branch: string; to: string[]; rowCount: number; messageId: string }>;
  skipped: Array<{ branch: string; reason: string; rowCount: number }>;
  failed: Array<{ branch: string; error: string }>;
  durationMs: number;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildBranchHtml(branch: string, digestDate: string, rows: CancelledCallRow[]): string {
  const preview = rows.slice(0, 25);
  const more = rows.length > preview.length ? rows.length - preview.length : 0;
  const trs = preview
    .map(
      (r) =>
        `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:12px">${escapeHtml(r.vtrnno)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:12px">${escapeHtml(r.callType ?? '')}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:12px">${escapeHtml(r.partyName ?? '')}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:12px">${escapeHtml(r.cancelReason)}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#0f172a">
  <h2 style="margin:0 0 8px">Cancelled calls — ${escapeHtml(branch)}</h2>
  <p style="margin:0 0 16px;color:#475569;font-size:14px">
    ${rows.length} cancelled call${rows.length === 1 ? '' : 's'} on ${escapeHtml(digestDate)} (IST).
    Full list attached as CSV.
  </p>
  <table style="border-collapse:collapse;width:100%;max-width:720px">
    <thead>
      <tr style="background:#f8fafc;text-align:left">
        <th style="padding:6px 8px;font-size:11px;color:#64748b">TRN</th>
        <th style="padding:6px 8px;font-size:11px;color:#64748b">Call type</th>
        <th style="padding:6px 8px;font-size:11px;color:#64748b">Party</th>
        <th style="padding:6px 8px;font-size:11px;color:#64748b">Reason</th>
      </tr>
    </thead>
    <tbody>${trs}</tbody>
  </table>
  ${more ? `<p style="color:#64748b;font-size:12px">…and ${more} more in the CSV.</p>` : ''}
</body></html>`;
}

export async function runCancelledCallDigest(options?: {
  digestDate?: string;
  dryRun?: boolean;
  /** Skip schedule window + send-log dedupe (portal test send). */
  force?: boolean;
  /** Override recipient list (CLI `--to=` test send). */
  forceTo?: string;
  /** Optional branch filter for test send. */
  branch?: string;
}): Promise<CancelledCallDigestResult> {
  const started = Date.now();
  const digestDate = options?.digestDate?.trim() || istYesterdayYmd();
  const dryRun = options?.dryRun === true;
  const force = options?.force === true;
  const forceTo = options?.forceTo?.trim() || '';
  const branchFilter = options?.branch?.trim() || '';

  if (!force && !dryRun) {
    const { getMisEmailOrgSettings } = await import('@/modules/mis-email/services/org-settings');
    const { shouldSendMisEmailNow } = await import('@/modules/mis-email/services/preferences');
    const org = await getMisEmailOrgSettings();
    if (
      !shouldSendMisEmailNow(
        { sendTimeIst: org.cancelledCallDigestSendTimeIst },
        { windowMinutes: 15 }
      )
    ) {
      return {
        digestDate,
        sent: [],
        skipped: [{ branch: '*', reason: 'outside_send_window', rowCount: 0 }],
        failed: [],
        durationMs: Date.now() - started,
      };
    }
  }

  await ensureCancelledCallDigestTables();
  let byBranch = await fetchCancelledCallsForDigestDay(digestDate);

  if (branchFilter) {
    const key = branchFilter.toUpperCase();
    const filtered = new Map<string, CancelledCallRow[]>();
    for (const [branch, rows] of byBranch) {
      if (branch.toUpperCase() === key || branch.toUpperCase().includes(key)) {
        filtered.set(branch, rows);
      }
    }
    byBranch = filtered;
  }

  const result: CancelledCallDigestResult = {
    digestDate,
    sent: [],
    skipped: [],
    failed: [],
    durationMs: 0,
  };

  for (const [branch, rows] of byBranch) {
    if (rows.length === 0) continue;

    if (!force && (await wasCancelledDigestAlreadySent(branch, digestDate))) {
      result.skipped.push({ branch, reason: 'already_sent', rowCount: rows.length });
      continue;
    }

    const people = await listEnabledCancelledDigestEmailsForBranch(branch);
    const to = forceTo
      ? [forceTo]
      : [...new Set(people.map((p) => p.email))];
    if (to.length === 0) {
      result.skipped.push({ branch, reason: 'no_enabled_recipients', rowCount: rows.length });
      continue;
    }
    const csv = buildCancelledCallsCsv(rows);
    const subject = `Cancelled calls — ${branch} — ${digestDate}`;
    const html = buildBranchHtml(branch, digestDate, rows);
    const text = `${rows.length} cancelled calls for ${branch} on ${digestDate} (IST). See CSV attachment.`;

    try {
      if (dryRun) {
        console.log(`[cancelled-call-digest] DRY RUN ${branch} → ${to.join(', ')} (${rows.length} rows)`);
        result.sent.push({ branch, to, rowCount: rows.length, messageId: 'dry-run' });
        continue;
      }

      const { messageId } = await sendPreparedDigestEmail({
        to,
        subject,
        html,
        text,
        attachments: [
          {
            filename: `cancelled-calls-${branch.replace(/\s+/g, '-')}-${digestDate}.csv`,
            content: Buffer.from(csv, 'utf8'),
            contentType: 'text/csv',
          },
        ],
      });

      await recordCancelledDigestSent({
        branch,
        digestDateYmd: digestDate,
        rowCount: rows.length,
        messageId,
      });

      result.sent.push({ branch, to, rowCount: rows.length, messageId });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[cancelled-call-digest] FAIL ${branch}:`, error);
      result.failed.push({ branch, error });
    }
  }

  result.durationMs = Date.now() - started;
  return result;
}
