import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { isGzipBuffer } from '@/modules/mis/client-import/services/upload-gzip';
import {
  isPlantInScope,
  resolveAllowedZss02Plants,
} from '@/modules/zss02/server/office-scope';
import { parseZss02Html } from '@/modules/zss02/server/parse';
import {
  buildZss02Workbook,
  zss02WorkbookFilename,
} from '@/modules/zss02/server/excel-export';
import {
  fetchLatestLoanDate,
  fetchZss02Options,
  insertZss02Import,
  listZss02Imports,
  partitionByPlantScope,
  queryZss02AllRows,
  queryZss02Rows,
} from '@/modules/zss02/server/store';
import type { Zss02ImportResult } from '@/modules/zss02/types';

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

function csvParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'zss02' });
    if (!auth.ok) return auth.response;

    const allowedPlants = await resolveAllowedZss02Plants(
      auth.security.isHod,
      auth.security.assignedOffices
    );

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'rows';

    if (mode === 'imports') {
      const imports = await listZss02Imports(allowedPlants);
      return NextResponse.json({ imports });
    }

    if (mode === 'options') {
      const options = await fetchZss02Options(allowedPlants);
      return NextResponse.json(options);
    }

    if (mode === 'rows' || mode === 'export') {
      const plants = csvParam(searchParams.get('plants'));
      const vendors = csvParam(searchParams.get('vendors'));
      const itemGroups = csvParam(searchParams.get('itemGroups'));
      const materials = csvParam(searchParams.get('materials'));
      for (const p of plants) {
        if (!isPlantInScope(p, allowedPlants)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      const baseFilters = {
        allowedPlants,
        plants,
        vendors,
        itemGroups,
        materials,
        barcode: (searchParams.get('barcode') ?? '').trim(),
        importId: (searchParams.get('importId') ?? '').trim(),
        loanFrom: (searchParams.get('loanFrom') ?? '').trim(),
        loanTo: (searchParams.get('loanTo') ?? '').trim(),
      };

      if (mode === 'export') {
        const [{ rows, truncated }, asOn] = await Promise.all([
          queryZss02AllRows(baseFilters),
          fetchLatestLoanDate(allowedPlants),
        ]);
        const workbook = await buildZss02Workbook(rows);
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
        const filename = zss02WorkbookFilename(asOn);
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${filename}"`,
            ...(truncated ? { 'X-ZSS02-Export-Truncated': '1' } : {}),
          },
        });
      }

      const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50) || 50));
      const data = await queryZss02Rows({
        ...baseFilters,
        page,
        pageSize,
      });
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  } catch (err) {
    console.error('[zss02 GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

async function importOneFile(
  file: File,
  fileName: string,
  contentEncoding: string | null,
  uploadedBy: string | null,
  allowedPlants: string[] | null
): Promise<Zss02ImportResult> {
  const name = fileName.toLowerCase();
  if (!name.endsWith('.htm') && !name.endsWith('.html')) {
    throw new Error(`Upload a .htm or .html report (${fileName})`);
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const buffer = inflateUpload(raw, contentEncoding);
  if (buffer.byteLength > MAX_HTML_BYTES) {
    throw new Error(
      `Decompressed file exceeds ${MAX_HTML_BYTES / (1024 * 1024)} MB limit (${fileName})`
    );
  }

  const parsed = parseZss02Html(buffer.toString('utf8'));
  const { keep, skippedOutOfScope } = partitionByPlantScope(parsed, allowedPlants);
  if (keep.length === 0 && parsed.length > 0) {
    throw new Error(`No in-scope plants in ${fileName}`);
  }

  return insertZss02Import({
    fileName,
    uploadedBy,
    rows: keep,
    skipped: skippedOutOfScope,
  });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'zss02' });
    if (!auth.ok) return auth.response;

    const allowedPlants = await resolveAllowedZss02Plants(
      auth.security.isHod,
      auth.security.assignedOffices
    );

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        {
          error:
            'Upload too large for the server. Retry — large HTML is gzipped automatically. If it still fails, split by plant.',
        },
        { status: 413 }
      );
    }

    const contentEncoding = String(formData.get('contentEncoding') ?? '').trim() || null;
    const files = formData.getAll('file').filter((f): f is File => f instanceof File);
    const single = formData.get('file');
    if (files.length === 0 && single instanceof File) files.push(single);

    if (files.length === 0) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const imports: Zss02ImportResult[] = [];
    for (const file of files) {
      const originalName =
        String(formData.get('fileName') ?? '').trim() || file.name || 'upload.html';
      // Multi-file: each File keeps its own name; optional fileName only for single-file posts.
      const fileName = files.length === 1 ? originalName : file.name || originalName;
      imports.push(
        await importOneFile(file, fileName, contentEncoding, auth.userId, allowedPlants)
      );
    }

    return NextResponse.json({ imports });
  } catch (err) {
    console.error('[zss02 POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
