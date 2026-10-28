import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { rebuildMb51Report } from '@/modules/mb51-aging/server/snapshot-read';
import type { Mb51AgingGroupBy, Mb51AgingReportParams } from '@/modules/mb51-aging/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const groupBy = String(body.groupBy || 'vm') as Mb51AgingGroupBy;
    if (!['mat', 'vendor', 'group', 'vm'].includes(groupBy)) {
      return NextResponse.json({ error: 'Invalid groupBy' }, { status: 400 });
    }
    const params: Mb51AgingReportParams = {
      basis: Number(body.basis),
      from: Number(body.from),
      to: Number(body.to),
      groupBy,
      plants: Array.isArray(body.plants) ? body.plants.map(String) : [],
      vendors: Array.isArray(body.vendors) ? body.vendors.map(String) : [],
      groups: Array.isArray(body.groups) ? body.groups.map(String) : [],
      materials: Array.isArray(body.materials) ? body.materials.map(String) : [],
      excludedMaterials: Array.isArray(body.excludedMaterials)
        ? body.excludedMaterials.map(String)
        : [],
    };
    if (!Number.isFinite(params.basis)) {
      return NextResponse.json({ error: 'basis required' }, { status: 400 });
    }
    if (!Number.isFinite(params.from)) params.from = -1e9;
    if (!Number.isFinite(params.to)) params.to = 1e9;

    const result = await rebuildMb51Report(params);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[mb51-aging report]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
