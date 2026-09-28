import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { isGzipBuffer } from '@/modules/mis/client-import/services/upload-gzip';
import { parseMb51Html } from '@/modules/spare-stock-analysis/server/parse-mb51-html';
import {
  isPlantInScope,
  resolveAllowedSpareStockPlants,
} from '@/modules/spare-stock-analysis/server/office-scope';
import {
  fetchDefectiveCompressorReport,
  fetchSpareStockOptions,
  fetchSpareStockRows,
  fetchSpareStockSummary,
  importSpareStockMovements,
  previewSpareStockImport,
  type SpareStockDashFilters,
} from '@/modules/spare-stock-analysis/server/store';
import type {
  SpareStockDbDupesChoice,
  SpareStockInFileDupesChoice,
} from '@/modules/spare-stock-analysis/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_HTML_BYTES = 32 * 1024 * 1024;

function inflateUpload(buffer: Buffer, contentEncoding: string | null): Buffer {
  const encoding = (contentEncoding ?? '').trim().toLowerCase();
  if (encoding !== 'gzip' && !isGzipBuffer(buffer)) return buffer;
  try {
    return gunzipSync(buffer);
  } catch {
    if (encoding === 'gzip') {
      throw new Error('Upload claimed gzip encoding but could not be decompressed');
    }
    return buffer;
  }
}

function csvList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFilters(
  searchParams: URLSearchParams,
  allowedPlants: string[] | null
): SpareStockDashFilters {
  const plants = csvList(searchParams.get('plants')).filter((p) => isPlantInScope(p, allowedPlants));
  return {
    startDate: searchParams.get('startDate')?.trim() || '1970-01-01',
    endDate: searchParams.get('endDate')?.trim() || '2099-12-31',
    plants,
    suppliers: csvList(searchParams.get('suppliers')),
    materials: csvList(searchParams.get('materials')),
    allowedPlants,
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'spare_stock_analysis' });
    if (!auth.ok) return auth.response;

    const allowedPlants = await resolveAllowedSpareStockPlants(
      auth.security.isHod,
      auth.security.assignedOffices
    );

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'summary';

    if (mode === 'options') {
      const options = await fetchSpareStockOptions(allowedPlants);
      return NextResponse.json(options);
    }

    const filters = parseFilters(searchParams, allowedPlants);

    if (mode === 'rows') {
      const page = Math.max(1, Number(searchParams.get('page')) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize')) || 50));
      const rows = await fetchSpareStockRows({ ...filters, page, pageSize });
      return NextResponse.json(rows);
    }

    if (mode === 'defective') {
      const report = await fetchDefectiveCompressorReport(filters);
      return NextResponse.json(report);
    }

    const summary = await fetchSpareStockSummary(filters);
    return NextResponse.json(summary);
  } catch (err) {
    console.error('[spare-stock-analysis GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'spare_stock_analysis' });
    if (!auth.ok) return auth.response;

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        {
          error:
            'Upload too large for the server. Retry — large HTML is gzipped automatically. If it still fails, export a shorter date range.',
        },
        { status: 413 }
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const originalName = String(formData.get('fileName') ?? file.name).trim() || file.name;
    const name = originalName.toLowerCase();
    if (!name.endsWith('.htm') && !name.endsWith('.html')) {
      return NextResponse.json({ error: 'Upload a .htm or .html MB51 report' }, { status: 400 });
    }

    const contentEncoding = String(formData.get('contentEncoding') ?? '').trim() || null;
    const raw = Buffer.from(await file.arrayBuffer());
    const buffer = inflateUpload(raw, contentEncoding);

    if (buffer.byteLength > MAX_HTML_BYTES) {
      return NextResponse.json(
        { error: `Decompressed file exceeds ${MAX_HTML_BYTES / (1024 * 1024)} MB limit` },
        { status: 413 }
      );
    }

    const html = buffer.toString('utf8');
    const parsed = parseMb51Html(html);
    const action = String(formData.get('action') ?? 'preview').trim();
    if (action !== 'commit') {
      const preview = await previewSpareStockImport({
        fileName: originalName,
        rows: parsed.rows,
        skipped: parsed.skipped,
      });
      return NextResponse.json(preview);
    }

    const inFileRaw = String(formData.get('inFileDupes') ?? 'skip');
    const dbRaw = String(formData.get('dbDupes') ?? 'skip');
    const inFileDupes: SpareStockInFileDupesChoice = inFileRaw === 'import' ? 'import' : 'skip';
    const dbDupes: SpareStockDbDupesChoice =
      dbRaw === 'replace' || dbRaw === 'keep' ? dbRaw : 'skip';

    const result = await importSpareStockMovements({
      fileName: originalName,
      uploadedBy: auth.userId,
      rows: parsed.rows,
      skipped: parsed.skipped,
      inFileDupes,
      dbDupes,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[spare-stock-analysis POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
