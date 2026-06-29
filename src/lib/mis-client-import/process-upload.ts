import { loadSourceConfigByCode } from '@/lib/mis-client-import/config';
import {
  emptyFileMessage,
  parseImportFile,
  sourceMismatchMessage,
} from '@/lib/mis-client-import/detect-parse';
import { normalizeClientRows } from '@/lib/mis-client-import/normalize';
import { storeImportBatch } from '@/lib/mis-client-import/store';
import type { ImportResult } from '@/lib/mis-client-import/types';

export async function processClientMisUpload(params: {
  sourceCode: string;
  fileName: string;
  buffer: Buffer;
  uploadedBy: string;
}): Promise<ImportResult & { warnings: string[]; errors: { row: number; message: string }[] }> {
  const config = await loadSourceConfigByCode(params.sourceCode);
  if (!config) {
    throw new Error(`Unknown client source: ${params.sourceCode}`);
  }

  const parsed = await parseImportFile(params.buffer, params.fileName, config);
  const parseWarnings = [...parsed.warnings];

  const mismatch = sourceMismatchMessage(parsed.sniffedSource, config.code);
  if (mismatch) {
    throw new Error(mismatch);
  }

  if (parsed.rawRows.length === 0) {
    throw new Error(
      emptyFileMessage(
        params.fileName,
        parsed.detectedFormat,
        parsed.sniffedSource,
        parsed.detectedHeaderRow
      )
    );
  }

  const { rows, errors, warnings } = normalizeClientRows(config, parsed.rawRows);
  const allWarnings = [...parseWarnings, ...warnings];

  if (rows.length === 0) {
    return {
      batchId: '',
      rowCount: 0,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      warnings: allWarnings,
      filterStart: null,
      filterEnd: null,
    };
  }

  const stored = await storeImportBatch({
    sourceId: config.id,
    sourceCode: config.code,
    uploadedBy: params.uploadedBy,
    fileName: params.fileName,
    fileBuffer: params.buffer,
    rows,
    errorCount: errors.length,
  });

  return {
    ...stored,
    errors: errors.slice(0, 50),
    warnings: allWarnings,
  };
}
