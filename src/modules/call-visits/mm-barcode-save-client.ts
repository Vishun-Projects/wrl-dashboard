import { fetchWithRetry } from '@/lib/net/fetch-with-retry';
import type { MmDocBarcodeImportMeta, MmDocBarcodeRow } from '@/modules/call-visits/mm-barcode-types';

const CHUNK = 8_000;

export async function saveMmDocBarcodeRows(
  fileName: string,
  rows: MmDocBarcodeRow[],
  onProgress?: (saved: number, total: number) => void
): Promise<MmDocBarcodeImportMeta> {
  if (!rows.length) throw new Error('No rows to save');
  let importId: string | null = null;
  let latest: MmDocBarcodeImportMeta | null = null;

  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const res = await fetchWithRetry('/api/report/call-visits/mm-barcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        fileName,
        rows: chunk,
        replaceExisting: offset === 0,
        importId,
        seqOffset: offset,
        expectedTotal: rows.length,
      }),
    });
    const body = (await res.json()) as { success?: boolean; import?: MmDocBarcodeImportMeta; error?: string };
    if (!res.ok || !body.import) {
      throw new Error(body.error ?? 'MM barcode save failed');
    }
    importId = body.import.id;
    latest = body.import;
    onProgress?.(Math.min(offset + CHUNK, rows.length), rows.length);
  }
  if (!latest) throw new Error('MM barcode save produced no import');
  return latest;
}
