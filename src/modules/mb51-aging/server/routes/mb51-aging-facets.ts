import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  fetchMb51Facets,
  type Mb51FacetField,
} from '@/modules/mb51-aging/server/snapshot-read';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FACET_FIELDS = new Set<Mb51FacetField>([
  'plants',
  'vendors',
  'groups',
  'materials',
  'movements',
]);

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;
    const fields = (sp.get('fields') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is Mb51FacetField => FACET_FIELDS.has(s as Mb51FacetField));
    return NextResponse.json(
      await fetchMb51Facets({
        q: sp.get('q') || '',
        limit: Number(sp.get('limit') || 400),
        importId: sp.get('importId'),
        fields: fields.length ? fields : undefined,
      })
    );
  } catch (err) {
    console.error('[mb51-aging facets]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
