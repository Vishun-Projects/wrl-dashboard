import {
  buildRegisterExcelWorkbook,
  detailedMisRegisterFilename,
  registerWorkbookToBuffer,
} from '@/modules/mis/register';
import {
  buildKeyAccountMisWorkbook,
  buildSummaryDashboardWorkbook,
  keyAccountMisFilename,
  summaryDashboardFilename,
  workbookToBuffer,
  bdMisOpenCallsFilename,
  buildBdMisOpenCallsWorkbook,
  buildBdMisTraceableWorkbook,
  bdMisTraceableFilename,
  type BdMisTraceableExportPayload,
} from '@/modules/mis';
import { isRegisterRowCancelled } from '@/lib/call/status/register-row';
import type { SummaryDashboard } from '@/lib/summary/derive';
import type { DigestRecipient } from '@/modules/mail-alerts/services/recipients';
import type { EffectiveDigestIncludes } from '@/modules/mail-alerts/services/preferences';
import { formatBytes } from '@/modules/mail-alerts/services/timing';

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
  if (includes.includeOpenCallsExport) {
    filenames.push(bdMisOpenCallsFilename(date));
  }
  return filenames;
}

function excludeCancelledFromTracePayload(
  payload: BdMisTraceableExportPayload
): BdMisTraceableExportPayload {
  const remapMetrics = <T extends { total_calls: number; total_solved: number; open_calls: number }>(
    row: T
  ): T => ({
    ...row,
    total_calls: Number(row.total_solved || 0) + Number(row.open_calls || 0),
  });

  return {
    ...payload,
    regionalRows: payload.regionalRows.map(remapMetrics),
    grand: remapMetrics(payload.grand),
    crmBranchSummary: payload.crmBranchSummary.map((b) => ({
      ...b,
      total_calls: Number(b.solved_calls || 0) + Number(b.open_calls || 0),
      cancelled_calls: 0,
    })),
    crmAccountSummary: payload.crmAccountSummary.map((a) => ({
      ...a,
      total_calls: Number(a.total_solved || 0) + Number(a.open_calls || 0),
      cancelled_calls: 0,
    })),
    clientAccountSummary: payload.clientAccountSummary.map((a) => ({
      ...a,
      total_calls: Number(a.total_solved || 0) + Number(a.open_calls || 0),
      cancelled_calls: 0,
    })),
  };
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
    includeOpenCallsExport: false,
  };

  const tasks: Promise<EmailAttachment>[] = [];

  if (includes.includeSummary) {
    tasks.push(
      (async () => {
        const started = Date.now();
        const workbook = await buildSummaryDashboardWorkbook(data.branchSummary, 'Summary Dashboard', {
          excludeCancelled: true,
        });
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
        const rows = (options?.registerRows ?? []).filter((row) => !isRegisterRowCancelled(row));
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
        const workbook = await buildKeyAccountMisWorkbook(data.accountSummary, 'Key Account MIS', {
          excludeCancelled: true,
        });
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
        const workbook = await buildBdMisTraceableWorkbook(
          excludeCancelledFromTracePayload(payload)
        );
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

  if (includes.includeOpenCallsExport) {
    tasks.push(
      (async () => {
        const payload = options?.tracePayload;
        if (!payload) {
          throw new Error('Open calls export data was not prepared');
        }
        const started = Date.now();
        const workbook = await buildBdMisOpenCallsWorkbook(
          excludeCancelledFromTracePayload(payload)
        );
        const workbookMs = Date.now() - started;
        const bufferStarted = Date.now();
        const content = await workbookToBuffer(workbook);
        const filename = bdMisOpenCallsFilename(date);
        console.log(
          `[mis-email/timing] attachment open-calls · workbook ${workbookMs}ms · buffer ${Date.now() - bufferStarted}ms · ${formatBytes(content.length)} · traceRows=${payload.traceRows.length}`
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
