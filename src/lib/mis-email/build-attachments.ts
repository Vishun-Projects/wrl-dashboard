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
import {
  buildBdMisTraceableWorkbook,
  bdMisTraceableFilename,
  type BdMisTraceableExportPayload,
} from '@/lib/report/bd-mis-excel-export';
import type { SummaryDashboard } from '@/lib/report/summary-derive';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
import type { EffectiveDigestIncludes } from '@/lib/mis-email/preferences';
import { formatBytes } from '@/lib/mis-email/timing';

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Attachment names only — used for email preview without building workbooks. */
export function resolveDigestAttachmentFilenames(
  includes: EffectiveDigestIncludes,
  date = new Date()
): string[] {
  const filenames: string[] = [];
  if (includes.includeSummary) {
    filenames.push(summaryDashboardFilename(date));
  }
  if (includes.includeDetailed) {
    filenames.push(detailedMisRegisterFilename(date));
  }
  if (includes.includeKeyAccount) {
    filenames.push(keyAccountMisFilename(date));
  }
  if (includes.includeTraceableExport) {
    filenames.push(bdMisTraceableFilename(date));
  }
  return filenames;
}

export async function buildDigestAttachments(
  recipient: DigestRecipient,
  data: SummaryDashboard,
  options?: {
    registerRows?: Record<string, unknown>[];
    date?: Date;
    effectiveIncludes?: EffectiveDigestIncludes;
    tracePayload?: BdMisTraceableExportPayload;
  }
): Promise<EmailAttachment[]> {
  const date = options?.date ?? new Date();
  const includes = options?.effectiveIncludes ?? {
    includeSummary: recipient.includeSummary,
    includeDetailed: recipient.includeDetailed,
    includeKeyAccount: recipient.includeKeyAccount,
    includeTraceableExport: false,
  };

  const tasks: Promise<EmailAttachment>[] = [];

  if (includes.includeSummary) {
    tasks.push(
      (async () => {
        const started = Date.now();
        const workbook = await buildSummaryDashboardWorkbook(data.branchSummary);
        const workbookMs = Date.now() - started;
        const bufferStarted = Date.now();
        const content = await workbookToBuffer(workbook);
        const filename = summaryDashboardFilename(date);
        console.log(
          `[mis-email/timing] attachment summary · workbook ${workbookMs}ms · buffer ${Date.now() - bufferStarted}ms · ${formatBytes(content.length)} · branches=${data.branchSummary.length}`
        );
        return {
          filename,
          content,
          contentType: XLSX_CONTENT_TYPE,
        };
      })()
    );
  }

  if (includes.includeDetailed) {
    tasks.push(
      (async () => {
        const rows = options?.registerRows ?? [];
        if (rows.length === 0) {
          throw new Error('No register rows found for detailed MIS export');
        }
        const started = Date.now();
        const workbook = await buildRegisterExcelWorkbook(rows, { sheetName: 'Detailed MIS' });
        const workbookMs = Date.now() - started;
        const bufferStarted = Date.now();
        const content = await registerWorkbookToBuffer(workbook);
        const filename = detailedMisRegisterFilename(date);
        console.log(
          `[mis-email/timing] attachment detailed-register · workbook ${workbookMs}ms · buffer ${Date.now() - bufferStarted}ms · ${formatBytes(content.length)} · rows=${rows.length}`
        );
        return {
          filename,
          content,
          contentType: XLSX_CONTENT_TYPE,
        };
      })()
    );
  }

  if (includes.includeKeyAccount) {
    tasks.push(
      (async () => {
        const started = Date.now();
        const workbook = await buildKeyAccountMisWorkbook(data.accountSummary);
        const workbookMs = Date.now() - started;
        const bufferStarted = Date.now();
        const content = await workbookToBuffer(workbook);
        const filename = keyAccountMisFilename(date);
        console.log(
          `[mis-email/timing] attachment key-account · workbook ${workbookMs}ms · buffer ${Date.now() - bufferStarted}ms · ${formatBytes(content.length)} · accounts=${data.accountSummary.length}`
        );
        return {
          filename,
          content,
          contentType: XLSX_CONTENT_TYPE,
        };
      })()
    );
  }

  if (includes.includeTraceableExport) {
    tasks.push(
      (async () => {
        const payload = options?.tracePayload;
        if (!payload) {
          throw new Error('Traceable export data was not prepared');
        }
        const started = Date.now();
        const workbook = await buildBdMisTraceableWorkbook(payload);
        const workbookMs = Date.now() - started;
        const bufferStarted = Date.now();
        const content = await workbookToBuffer(workbook);
        const filename = bdMisTraceableFilename(date);
        console.log(
          `[mis-email/timing] attachment traceable · workbook ${workbookMs}ms · buffer ${Date.now() - bufferStarted}ms · ${formatBytes(content.length)} · traceRows=${payload.traceRows.length}`
        );
        return {
          filename,
          content,
          contentType: XLSX_CONTENT_TYPE,
        };
      })()
    );
  }

  const allStarted = Date.now();
  const attachments = await Promise.all(tasks);
  console.log(
    `[mis-email/timing] attachments total (parallel): ${Date.now() - allStarted}ms · count=${attachments.length}`
  );
  return attachments;
}
