import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { isGzipBuffer } from '@/modules/mis/client-import/services/upload-gzip';
import { enrichMissingItemCategories } from '@/modules/spare-loan-check/server/item-category';
import { runSpareLoanCheck } from '@/modules/spare-loan-check/server/run-check';
import {
  listSpareLoanSavedPlants,
  loadSpareLoanAllPlants,
  loadSpareLoanPlant,
} from '@/modules/spare-loan-check/server/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Decompressed HTML ceiling (client gzips on the wire for Vercel payload limits). */
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

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'spare_loan_check' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'plants';
    const plant = searchParams.get('plant')?.trim() ?? '';

    if (mode === 'plants') {
      const plants = await listSpareLoanSavedPlants();
      return NextResponse.json({ plants });
    }

    if (mode === 'rows') {
      if (!plant) {
        const loaded = await loadSpareLoanAllPlants();
        const rows = await enrichMissingItemCategories(loaded.rows);
        return NextResponse.json({
          summary: loaded.summary,
          rows,
          savedPlants: loaded.savedPlants,
        });
      }
      const loaded = await loadSpareLoanPlant(plant);
      if (!loaded) {
        return NextResponse.json({ error: `No saved import for plant ${plant}` }, { status: 404 });
      }
      const rows = await enrichMissingItemCategories(loaded.rows);
      return NextResponse.json({
        summary: loaded.summary,
        rows,
        savedPlants: [plant],
      });
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  } catch (err) {
    console.error('[spare-loan-check GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'spare_loan_check' });
    if (!auth.ok) return auth.response;

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

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const originalName = String(formData.get('fileName') ?? file.name).trim() || file.name;
    const name = originalName.toLowerCase();
    if (!name.endsWith('.htm') && !name.endsWith('.html')) {
      return NextResponse.json({ error: 'Upload a .htm or .html report' }, { status: 400 });
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
    const result = await runSpareLoanCheck(html, {
      fileName: originalName,
      uploadedBy: auth.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[spare-loan-check]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
