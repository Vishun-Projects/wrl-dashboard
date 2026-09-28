import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { MIS_UPLOAD_CHUNK_BYTES_MAX } from '@/modules/mis/client-import/services/upload-chunk-constants';
import {
  deleteUploadChunks,
  purgeStaleUploadChunks,
  readAssembledUpload,
  storeUploadChunk,
} from '@/modules/mis/client-import/services/upload-chunks';
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
import {
  SPARE_STOCK_CHUNK_SOURCE,
  type SpareStockDbDupesChoice,
  type SpareStockInFileDupesChoice,
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isMb51Name(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.htm') || lower.endsWith('.html');
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

async function loadHtmlFromForm(
  formData: FormData,
  userId: string
): Promise<{ originalName: string; html: string; uploadId: string | null } | NextResponse> {
  const uploadId = String(formData.get('uploadId') ?? '').trim();
  const contentEncoding = String(formData.get('contentEncoding') ?? '').trim() || null;

  let originalName: string;
  let raw: Buffer;

  if (uploadId) {
    if (!isUuid(uploadId)) {
      return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400 });
    }
    const assembled = await readAssembledUpload(uploadId, userId);
    if ('status' in assembled) {
      return NextResponse.json(assembled.body, { status: assembled.status });
    }
    if (assembled.sourceCode !== SPARE_STOCK_CHUNK_SOURCE) {
      return NextResponse.json({ error: 'Wrong upload type' }, { status: 400 });
    }
    originalName = String(formData.get('fileName') ?? assembled.fileName).trim() || assembled.fileName;
    raw = assembled.buffer;
  } else {
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }
    originalName = String(formData.get('fileName') ?? file.name).trim() || file.name;
    raw = Buffer.from(await file.arrayBuffer());
  }

  if (!isMb51Name(originalName)) {
    return NextResponse.json({ error: 'Upload a .htm or .html MB51 report' }, { status: 400 });
  }

  const buffer = inflateUpload(raw, contentEncoding);
  if (buffer.byteLength > MAX_HTML_BYTES) {
    return NextResponse.json(
      { error: `Decompressed file exceeds ${MAX_HTML_BYTES / (1024 * 1024)} MB limit` },
      { status: 413 }
    );
  }

  return { originalName, html: buffer.toString('utf8'), uploadId: uploadId || null };
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
            'Upload too large for the server. Large files are split automatically — retry the import.',
        },
        { status: 413 }
      );
    }

    const action = String(formData.get('action') ?? 'preview').trim();

    if (action === 'abort') {
      const uploadId = String(formData.get('uploadId') ?? '').trim();
      if (uploadId && isUuid(uploadId)) await deleteUploadChunks(uploadId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'chunk') {
      void purgeStaleUploadChunks().catch(() => {});
      const uploadId = String(formData.get('uploadId') ?? '').trim();
      const chunkIndex = Number(formData.get('chunkIndex'));
      const chunkTotal = Number(formData.get('chunkTotal'));
      const fileName = String(formData.get('fileName') ?? '').trim();
      const chunk = formData.get('chunk');
      if (!isUuid(uploadId) || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkTotal)) {
        return NextResponse.json(
          { error: 'uploadId, chunkIndex, chunkTotal are required' },
          { status: 400 }
        );
      }
      if (chunkTotal < 1 || chunkIndex < 0 || chunkIndex >= chunkTotal) {
        return NextResponse.json({ error: 'Invalid chunk index' }, { status: 400 });
      }
      if (!fileName || !isMb51Name(fileName)) {
        return NextResponse.json({ error: 'Upload a .htm or .html MB51 report' }, { status: 400 });
      }
      if (!(chunk instanceof Blob)) {
        return NextResponse.json({ error: 'chunk is required' }, { status: 400 });
      }
      if (chunk.size > MIS_UPLOAD_CHUNK_BYTES_MAX) {
        return NextResponse.json({ error: 'Chunk exceeds size limit' }, { status: 413 });
      }
      await storeUploadChunk({
        uploadId,
        chunkIndex,
        chunkTotal,
        sourceCode: SPARE_STOCK_CHUNK_SOURCE,
        fileName,
        uploadedBy: auth.userId,
        data: Buffer.from(await chunk.arrayBuffer()),
      });
      return NextResponse.json({ ok: true, chunkIndex, chunkTotal });
    }

    const loaded = await loadHtmlFromForm(formData, auth.userId);
    if (loaded instanceof NextResponse) return loaded;

    const parsed = parseMb51Html(loaded.html);
    if (action !== 'commit') {
      const preview = await previewSpareStockImport({
        fileName: loaded.originalName,
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
      fileName: loaded.originalName,
      uploadedBy: auth.userId,
      rows: parsed.rows,
      skipped: parsed.skipped,
      inFileDupes,
      dbDupes,
    });
    if (loaded.uploadId) await deleteUploadChunks(loaded.uploadId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[spare-stock-analysis POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
