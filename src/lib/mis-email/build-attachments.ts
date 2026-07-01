import {
  buildRegisterExcelWorkbook,
  detailedMisRegisterFilename,
  registerWorkbookToBuffer,
} from '@/lib/register/excel-export';
import {
  buildKeyAccountMisWorkbook,
  buildSummaryDashboardWorkbook,
  keyAccountMisFilename,
  summaryDashboardFilename,
  workbookToBuffer,
} from '@/lib/report/summary-excel-export';
import type { SummaryDashboard } from '@/lib/report/summary-derive';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
import type { EffectiveDigestIncludes } from '@/lib/mis-email/preferences';

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function buildDigestAttachments(
  recipient: DigestRecipient,
  data: SummaryDashboard,
  options?: {
    registerRows?: Record<string, unknown>[];
    date?: Date;
    effectiveIncludes?: EffectiveDigestIncludes;
  }
): Promise<EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];
  const date = options?.date ?? new Date();
  const includes = options?.effectiveIncludes ?? {
    includeSummary: recipient.includeSummary,
    includeDetailed: recipient.includeDetailed,
    includeKeyAccount: recipient.includeKeyAccount,
  };

  if (includes.includeSummary) {
    const workbook = await buildSummaryDashboardWorkbook(data.branchSummary);
    attachments.push({
      filename: summaryDashboardFilename(date),
      content: await workbookToBuffer(workbook),
      contentType: XLSX_CONTENT_TYPE,
    });
  }

  if (includes.includeDetailed) {
    const rows = options?.registerRows ?? [];
    if (rows.length === 0) {
      throw new Error('No register rows found for detailed MIS export');
    }
    const workbook = await buildRegisterExcelWorkbook(rows, { sheetName: 'Detailed MIS' });
    attachments.push({
      filename: detailedMisRegisterFilename(date),
      content: await registerWorkbookToBuffer(workbook),
      contentType: XLSX_CONTENT_TYPE,
    });
  }

  if (includes.includeKeyAccount) {
    const workbook = await buildKeyAccountMisWorkbook(data.accountSummary);
    attachments.push({
      filename: keyAccountMisFilename(date),
      content: await workbookToBuffer(workbook),
      contentType: XLSX_CONTENT_TYPE,
    });
  }

  return attachments;
}
