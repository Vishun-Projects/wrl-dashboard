import {
  buildKeyAccountMisWorkbook,
  buildSummaryDashboardWorkbook,
  keyAccountMisFilename,
  summaryDashboardFilename,
  workbookToBuffer,
} from '@/lib/report/summary-excel-export';
import type { SummaryDashboard } from '@/lib/report/summary-derive';
import type { DigestRecipient } from '@/lib/mis-email/recipients';

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export async function buildDigestAttachments(
  recipient: DigestRecipient,
  data: SummaryDashboard,
  date = new Date()
): Promise<EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];
  const contentType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (recipient.includeSummary) {
    const workbook = await buildSummaryDashboardWorkbook(data.branchSummary);
    attachments.push({
      filename: summaryDashboardFilename(date),
      content: await workbookToBuffer(workbook),
      contentType,
    });
  }

  if (recipient.includeKeyAccount) {
    const workbook = await buildKeyAccountMisWorkbook(data.accountSummary);
    attachments.push({
      filename: keyAccountMisFilename(date),
      content: await workbookToBuffer(workbook),
      contentType,
    });
  }

  return attachments;
}
