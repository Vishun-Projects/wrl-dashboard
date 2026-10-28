import { NextRequest, NextResponse } from 'next/server';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import type { MmDocBarcodeRow } from '@/modules/call-visits/mm-barcode-types';
import {
  fetchLatestMmDocBarcodeMeta,
  saveMmDocBarcodeImport,
} from '@/modules/call-visits/server/mm-barcode-store';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'call_visits' });
    if (!auth.ok) return auth.response;
    return NextResponse.json({ latestImport: await fetchLatestMmDocBarcodeMeta() });
  } catch (err) {
    console.error('[mm-barcodes GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

type SaveBody = {
  fileName?: string;
  rows?: MmDocBarcodeRow[];
  replaceExisting?: boolean;
  importId?: string | null;
  seqOffset?: number;
  expectedTotal?: number;
};

export async function POST(req: NextRequest) {
  const originDenied = assertSameOriginMutation(req);
  if (originDenied) return originDenied;
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'call_visits' });
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as SaveBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return NextResponse.json({ error: 'No rows to save' }, { status: 400 });
    }
    const fileName = (body.fileName ?? 'mm-doc-barcode.xlsx').trim() || 'mm-doc-barcode.xlsx';
    const meta = await saveMmDocBarcodeImport({
      fileName,
      uploadedBy: auth.userId ?? null,
      rows,
      replaceExisting: body.replaceExisting !== false,
      importId: body.importId ?? null,
      seqOffset: body.seqOffset ?? 0,
      expectedTotal: body.expectedTotal,
    });
    return NextResponse.json({ success: true, import: meta });
  } catch (err) {
    console.error('[mm-barcodes POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
