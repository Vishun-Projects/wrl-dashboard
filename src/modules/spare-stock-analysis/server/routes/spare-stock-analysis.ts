import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { isGzipBuffer } from '@/modules/mis/client-import/services/upload-gzip';
import {
  isPlantInScope,
  resolveAllowedSpareStockPlants,
} from '@/modules/spare-stock-analysis/server/office-scope';
import {
  abortSpareStockStaging,
  fetchDefectiveCompressorReport,
  fetchSpareStockOptions,
  fetchSpareStockRows,
  fetchSpareStockSummary,
  fetchSpareStockUnmapped,
  importSpareStockFromStaging,
  insertSpareStockStagingRows,
  previewSpareStockStaging,
  purgeStaleSpareStockStaging,
  type SpareStockDashFilters,
} from '@/modules/spare-stock-analysis/server/store';
import type {
  SpareStockDbDupesChoice,
  SpareStockInFileDupesChoice,
  SpareStockParsedRow,
  SpareStockTxnType,
} from '@/modules/spare-stock-analysis/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_ROWS_JSON_BYTES = 8 * 1024 * 1024;
const MAX_ROWS_PER_BATCH = 2000;
const TXN_TYPES = new Set<SpareStockTxnType>([
  'opening',
  'receipt',
  'issued',
  'consumption',
  'other',
]);

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
    uoms: csvList(searchParams.get('uoms')),
    allowedPlants,
  };
}

function isParsedRow(v: unknown): v is SpareStockParsedRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.plant === 'string' &&
    typeof r.matDoc === 'string' &&
    (r.docDate === null || typeof r.docDate === 'string') &&
    typeof r.postingDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.postingDate) &&
    typeof r.material === 'string' &&
    typeof r.materialDescription === 'string' &&
    typeof r.location === 'string' &&
    typeof r.uom === 'string' &&
    typeof r.qty === 'number' &&
    Number.isFinite(r.qty) &&
    (r.lcAmount === null || (typeof r.lcAmount === 'number' && Number.isFinite(r.lcAmount))) &&
    typeof r.mvt === 'string' &&
    typeof r.mvtText === 'string' &&
    typeof r.txnType === 'string' &&
    TXN_TYPES.has(r.txnType as SpareStockTxnType) &&
    typeof r.batch === 'string' &&
    (r.entryDate === null || typeof r.entryDate === 'string') &&
    typeof r.entryTime === 'string' &&
    typeof r.sapUser === 'string' &&
    typeof r.materialGroup === 'string' &&
    typeof r.customer === 'string' &&
    typeof r.headerText === 'string' &&
    typeof r.callNo === 'string' &&
    typeof r.matYr === 'string' &&
    typeof r.orderNo === 'string' &&
    typeof r.supplier === 'string' &&
    typeof r.rowKey === 'string' &&
    /^[0-9a-f]{64}$/.test(r.rowKey)
  );
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

    if (mode === 'unmapped') {
      const unmapped = await fetchSpareStockUnmapped(allowedPlants);
      return NextResponse.json({ unmapped });
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
        { error: 'Upload too large for the server. Rows are sent in small batches — retry the import.' },
        { status: 413 }
      );
    }

    const action = String(formData.get('action') ?? 'preview').trim();
    const uploadId = String(formData.get('uploadId') ?? '').trim();

    if (action === 'abort') {
      if (uploadId && isUuid(uploadId)) await abortSpareStockStaging(uploadId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'rows') {
      void purgeStaleSpareStockStaging().catch(() => {});
      if (!isUuid(uploadId)) {
        return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400 });
      }
      const fileName = String(formData.get('fileName') ?? '').trim();
      if (!fileName || !isMb51Name(fileName)) {
        return NextResponse.json({ error: 'Upload a .htm or .html MB51 report' }, { status: 400 });
      }
      const skippedDelta = Math.max(0, Number(formData.get('skipped')) || 0);
      const rowsPart = formData.get('rows');
      if (!(rowsPart instanceof Blob)) {
        return NextResponse.json({ error: 'rows is required' }, { status: 400 });
      }
      const contentEncoding = String(formData.get('contentEncoding') ?? '').trim() || null;
      const raw = Buffer.from(await rowsPart.arrayBuffer());
      const buffer = inflateUpload(raw, contentEncoding);
      if (buffer.byteLength > MAX_ROWS_JSON_BYTES) {
        return NextResponse.json({ error: 'Row batch is too large' }, { status: 413 });
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(buffer.toString('utf8'));
      } catch {
        return NextResponse.json({ error: 'Invalid row batch JSON' }, { status: 400 });
      }
      if (!Array.isArray(parsedJson)) {
        return NextResponse.json({ error: 'Row batch must be an array' }, { status: 400 });
      }
      if (parsedJson.length > MAX_ROWS_PER_BATCH) {
        return NextResponse.json({ error: 'Row batch exceeds limit' }, { status: 400 });
      }
      const rows: SpareStockParsedRow[] = [];
      for (const item of parsedJson) {
        if (!isParsedRow(item)) {
          return NextResponse.json({ error: 'Invalid row in batch' }, { status: 400 });
        }
        rows.push(item);
      }
      const totals = await insertSpareStockStagingRows({
        uploadId,
        fileName,
        uploadedBy: auth.userId,
        rows,
        skippedDelta,
      });
      return NextResponse.json({ ok: true, ...totals });
    }

    if (!isUuid(uploadId)) {
      return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400 });
    }

    if (action !== 'commit') {
      const preview = await previewSpareStockStaging(uploadId);
      return NextResponse.json(preview);
    }

    const inFileRaw = String(formData.get('inFileDupes') ?? 'skip');
    const dbRaw = String(formData.get('dbDupes') ?? 'skip');
    const inFileDupes: SpareStockInFileDupesChoice = inFileRaw === 'import' ? 'import' : 'skip';
    const dbDupes: SpareStockDbDupesChoice =
      dbRaw === 'replace' || dbRaw === 'keep' ? dbRaw : 'skip';

    const result = await importSpareStockFromStaging({
      uploadId,
      uploadedBy: auth.userId,
      inFileDupes,
      dbDupes,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[spare-stock-analysis POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
