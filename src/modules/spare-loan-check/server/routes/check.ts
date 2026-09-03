import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { runSpareLoanCheck } from '@/modules/spare-loan-check/server/run-check';
import {
  listSpareLoanSavedPlants,
  loadSpareLoanAllPlants,
  loadSpareLoanPlant,
} from '@/modules/spare-loan-check/server/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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
        return NextResponse.json({
          summary: loaded.summary,
          rows: loaded.rows,
          savedPlants: loaded.savedPlants,
        });
      }
      const loaded = await loadSpareLoanPlant(plant);
      if (!loaded) {
        return NextResponse.json({ error: `No saved import for plant ${plant}` }, { status: 404 });
      }
      return NextResponse.json({
        summary: loaded.summary,
        rows: loaded.rows,
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
            'Upload too large or invalid form data. Restart the dev server if this persists (large HTML needs body size allowance).',
        },
        { status: 413 }
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    if (!name.endsWith('.htm') && !name.endsWith('.html')) {
      return NextResponse.json({ error: 'Upload a .htm or .html report' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File exceeds 20 MB limit' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const html = buffer.toString('utf8');
    const result = await runSpareLoanCheck(html, {
      fileName: file.name,
      uploadedBy: auth.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[spare-loan-check]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
