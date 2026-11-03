import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  fetchWarrantyProvisionOptions,
  queryWarrantyProvisionRows,
} from '@/modules/warranty-provision/server/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

function csvParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'warranty_provision' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'rows';

    if (mode === 'options') {
      const options = await fetchWarrantyProvisionOptions();
      return NextResponse.json(options);
    }

    if (mode === 'rows') {
      const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(1000, Math.max(1, Number(searchParams.get('pageSize') ?? 100) || 100));
      const data = await queryWarrantyProvisionRows({
        materialGroups: csvParam(searchParams.get('materialGroups')),
        customerSubgroups: csvParam(searchParams.get('customerSubgroups')),
        states: csvParam(searchParams.get('states')),
        cities: csvParam(searchParams.get('cities')),
        materials: csvParam(searchParams.get('materials')),
        warrantyRemainingDays: csvParam(searchParams.get('warrantyRemainingDays')),
        warrantyEndFys: csvParam(searchParams.get('warrantyEndFys')),
        q: (searchParams.get('q') ?? '').trim(),
        billingFrom: (searchParams.get('billingFrom') ?? '').trim(),
        billingTo: (searchParams.get('billingTo') ?? '').trim(),
        page,
        pageSize,
      });
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  } catch (err) {
    console.error('[warranty-provision GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
