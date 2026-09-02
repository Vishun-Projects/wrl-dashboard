import {
  buildCancelledCallsWorkbook,
  cancelledCallsOverview,
  cancelledCallsWorkbookFilename,
  fetchCancelledCallsForDigestDay,
  istYesterdayYmd,
} from '@/modules/cancelled-calls';
import {
  ensureCancelledCallDigestTables,
  listCancelledCallDigestRecipients,
  recordCancelledDigestSent,
  wasCancelledDigestAlreadySent,
} from '@/modules/mis-email/server/sync/cancelled-call-digest-recipients';
import { sendPreparedDigestEmail } from '@/modules/mis-email/services/send';
import { workbookToBuffer } from '@/modules/mis';
import type { CancelledCallRow } from '@/modules/cancelled-calls/types';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

function buildOverviewHtml(
  digestDate: string,
  byBranch: Map<string, CancelledCallRow[]>
): string {
  const overview = cancelledCallsOverview(byBranch);
  const total = overview.reduce((sum, row) => sum + row.count, 0);
  const rows = overview
    .map(
      (row) =>
        `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:13px">${escapeHtml(row.branch)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right">${row.count}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#0f172a">
  <h2 style="margin:0 0 8px">Cancelled calls — ${escapeHtml(digestDate)}</h2>
  <p style="margin:0 0 16px;color:#475569;font-size:14px">
    ${total} cancelled call${total === 1 ? '' : 's'} across ${overview.length} branch${overview.length === 1 ? '' : 'es'} (IST).
    Full list attached as Excel.
  </p>
  <table style="border-collapse:collapse;width:100%;max-width:420px">
    <thead>
      <tr style="background:#f8fafc;text-align:left">
        <th style="padding:6px 8px;font-size:11px;color:#64748b">Branch</th>
        <th style="padding:6px 8px;font-size:11px;color:#64748b;text-align:right">Count</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr style="background:#f8fafc;font-weight:600">
        <td style="padding:6px 8px;font-size:13px">Total</td>
        <td style="padding:6px 8px;font-size:13px;text-align:right">${total}</td>
      </tr>
    </tbody>
  </table>
</body></html>`;
}

function buildOverviewText(byBranch: Map<string, CancelledCallRow[]>): string {
  const overview = cancelledCallsOverview(byBranch);
  const total = overview.reduce((sum, row) => sum + row.count, 0);
  const lines = overview.map((row) => `${row.branch}: ${row.count}`);
  lines.push(`Total: ${total}`);
  return lines.join('\n');
}

async function pendingBranchesForRecipient(
  branches: string[],
  digestDate: string,
  force: boolean
): Promise<string[]> {
  const pending: string[] = [];
  for (const branch of branches) {
    if (force || !(await wasCancelledDigestAlreadySent(branch, digestDate))) {
      pending.push(branch);
    }
  }
  return pending;
}

async function buildRecipientPlans(options: {
  byBranch: Map<string, CancelledCallRow[]>;
  forceTo: string;
  branchFilter: string;
}): Promise<Map<string, string[]>> {
  const { byBranch, forceTo, branchFilter } = options;
  const plans = new Map<string, string[]>();

  if (forceTo) {
    const branches = [...byBranch.keys()].filter((branch) => (byBranch.get(branch)?.length ?? 0) > 0);
    if (branches.length) plans.set(forceTo, branches);
    return plans;
  }

  const recipients = await listCancelledCallDigestRecipients();
  for (const recipient of recipients) {
    if (!recipient.enabled) continue;
    if (branchFilter) {
      const key = branchFilter.toUpperCase();
      const branchKey = recipient.branch.toUpperCase();
      if (branchKey !== key && !branchKey.includes(key)) continue;
    }
    if (!(byBranch.get(recipient.branch)?.length ?? 0)) continue;
    const existing = plans.get(recipient.email) ?? [];
    if (!existing.includes(recipient.branch)) existing.push(recipient.branch);
    plans.set(recipient.email, existing);
  }

  return plans;
}

function subsetByBranches(
  byBranch: Map<string, CancelledCallRow[]>,
  branches: string[]
): Map<string, CancelledCallRow[]> {
  const out = new Map<string, CancelledCallRow[]>();
  for (const branch of branches) {
    const rows = byBranch.get(branch);
    if (rows?.length) out.set(branch, rows);
  }
  return out;
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

  const recipientPlans = await buildRecipientPlans({ byBranch, forceTo, branchFilter });

  for (const [email, branches] of recipientPlans) {
    const pendingBranches = await pendingBranchesForRecipient(branches, digestDate, force);
    if (!pendingBranches.length) {
      for (const branch of branches) {
        const rowCount = byBranch.get(branch)?.length ?? 0;
        result.skipped.push({ branch, reason: 'already_sent', rowCount });
      }
      continue;
    }

    const scoped = subsetByBranches(byBranch, pendingBranches);
    const rows = pendingBranches.flatMap((branch) => byBranch.get(branch) ?? []);
    if (!rows.length) continue;

    const subject = `Cancelled calls — ${digestDate}`;
    const html = buildOverviewHtml(digestDate, scoped);
    const text = `Cancelled calls on ${digestDate} (IST):\n${buildOverviewText(scoped)}\n\nSee Excel attachment.`;
    const branchLabel = pendingBranches.join(', ');

    try {
      if (dryRun) {
        console.log(
          `[cancelled-call-digest] DRY RUN → ${email} (${rows.length} rows, ${pendingBranches.length} branches)`
        );
        result.sent.push({
          branch: branchLabel,
          to: [email],
          rowCount: rows.length,
          messageId: 'dry-run',
        });
        continue;
      }

      const workbook = await buildCancelledCallsWorkbook(scoped);
      const content = await workbookToBuffer(workbook);
      const { messageId } = await sendPreparedDigestEmail({
        to: [email],
        subject,
        html,
        text,
        attachments: [
          {
            filename: cancelledCallsWorkbookFilename(digestDate),
            content,
            contentType: XLSX_CONTENT_TYPE,
          },
        ],
      });

      for (const branch of pendingBranches) {
        await recordCancelledDigestSent({
          branch,
          digestDateYmd: digestDate,
          rowCount: byBranch.get(branch)?.length ?? 0,
          messageId,
        });
      }

      result.sent.push({
        branch: branchLabel,
        to: [email],
        rowCount: rows.length,
        messageId,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[cancelled-call-digest] FAIL ${email}:`, error);
      result.failed.push({ branch: branchLabel, error });
    }
  }

  for (const [branch, rows] of byBranch) {
    if (!rows.length) continue;
    const covered = [...recipientPlans.values()].some((branches) => branches.includes(branch));
    if (!covered) {
      result.skipped.push({ branch, reason: 'no_enabled_recipients', rowCount: rows.length });
    }
  }

  result.durationMs = Date.now() - started;
  return result;
}
