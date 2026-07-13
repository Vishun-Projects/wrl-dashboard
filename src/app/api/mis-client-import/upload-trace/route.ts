import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';

/**
 * Browser posts safe upload diagnostics here so they appear in Vercel function logs.
 * Never send raw access tokens.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    console.info('[mis-upload-trace]', {
      userId: auth.userId,
      at: new Date().toISOString(),
      ...(body ?? {}),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[mis-upload-trace] failed', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
