import { createHash } from 'crypto';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { fetchCrmImageBuffer } from '@/lib/barcode-scan/fetch-crm-image';
import { barcodeMatchesOcrText } from '@/lib/barcode-scan/match-barcode-text';
import { scanImage } from '@/lib/barcode-scan/scan-image';

const UPLOAD_BASE = 'https://westerncrm.com/WRL/UploadDocs';
const OCR_TIMEOUT_MS = 90_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const runtime = 'nodejs';

function resolveCacheDir(): string {
  if (process.env.BARCODE_OCR_CACHE_DIR?.trim()) {
    return process.env.BARCODE_OCR_CACHE_DIR.trim();
  }
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'barcode-ocr');
  }
  return path.join(process.cwd(), '.cache', 'barcode-ocr');
}

function cacheFilePath(cacheKey: string): string {
  const hash = createHash('sha256').update(cacheKey).digest('hex');
  return path.join(resolveCacheDir(), `${hash}.json`);
}

function isSafeFilename(filename: string): boolean {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+\.(jpe?g|png|webp)$/i.test(filename);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveReportSecurity(user.id, { pagePermission: 'page_serial_audit' });
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const officeId = String(body.officeId ?? '').trim();
    const filename = String(body.filename ?? '').trim();
    const newBarcode = String(body.newBarcode ?? '').trim();

    if (!officeId || !isSafeFilename(filename)) {
      return NextResponse.json({ error: 'Invalid officeId or filename' }, { status: 400 });
    }

    const cacheKey = `${officeId}/${filename}@ocr-v4`;
    const cachePath = cacheFilePath(cacheKey);

    try {
      await access(cachePath);
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as {
        text: string;
        tokens: string[];
        barcodes?: string[];
        matchesNew?: boolean;
      };
      if (newBarcode && cached.matchesNew === undefined) {
        cached.matchesNew = barcodeMatchesOcrText(
          newBarcode,
          cached.text,
          cached.tokens,
          cached.barcodes ?? []
        );
      }
      return NextResponse.json(cached);
    } catch {
      /* cache miss */
    }

    const imageUrl = `${UPLOAD_BASE}/${officeId}/${filename}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

    try {
      const buffer = await fetchCrmImageBuffer(imageUrl, controller.signal);
      if (buffer.length > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'Image too large for OCR' }, { status: 413 });
      }
      const result = await scanImage(buffer, newBarcode || undefined);

      await mkdir(resolveCacheDir(), { recursive: true });
      await writeFile(cachePath, JSON.stringify(result), 'utf8');

      return NextResponse.json(result);
    } catch (err) {
      if (controller.signal.aborted) {
        return NextResponse.json({ error: 'OCR timeout' }, { status: 504 });
      }
      const message = err instanceof Error ? err.message : 'OCR failed';
      console.error('[barcode-scan/read-image]', err);
      return NextResponse.json({ error: message }, { status: 500 });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('[barcode-scan/read-image]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
