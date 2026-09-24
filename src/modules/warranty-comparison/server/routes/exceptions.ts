import { NextRequest, NextResponse } from 'next/server';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { postQuery } from '@/lib/db/proxy';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { buildMstRepairMasterListSql } from '@/sql/trhcalls/query';
import {
  deleteExceptionAccount,
  listExceptionAccounts,
  listSystemAccountOptions,
  upsertExceptionAccount,
  type ExceptionAccountWrite,
} from '../exceptions';
import type { ExceptionWorkDoneMode } from '../../exception-cover';

export const maxDuration = 120;

async function requireAuth(req: NextRequest) {
  return resolveRequestReportSecurity(req, { pageId: 'warranty_master' });
}

function parseWrite(body: Record<string, unknown>): ExceptionAccountWrite {
  const mode = String(body.workDoneMode ?? 'none');
  return {
    systemAccount: String(body.systemAccount ?? ''),
    amc: Boolean(body.amc),
    amcValidUpto: body.amcValidUpto ? String(body.amcValidUpto) : null,
    compressorWarrantyMonths:
      body.compressorWarrantyMonths == null || body.compressorWarrantyMonths === ''
        ? null
        : Number(body.compressorWarrantyMonths),
    workDoneMode: (mode === 'any' || mode === 'selected' ? mode : 'none') as ExceptionWorkDoneMode,
    workDoneRepairNcodes: Array.isArray(body.workDoneRepairNcodes)
      ? body.workDoneRepairNcodes.map(String)
      : [],
    enabled: body.enabled !== false,
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const mode = new URL(req.url).searchParams.get('mode') ?? 'list';
    if (mode === 'accounts') {
      return NextResponse.json({ accounts: await listSystemAccountOptions() });
    }
    if (mode === 'repairs') {
      const res = await postQuery({ rawSql: buildMstRepairMasterListSql(), timeoutMs: 60_000 });
      const rows = (res.data || []) as Record<string, unknown>[];
      const repairs = rows
        .map((r) => ({
          value: String(r.ncode ?? '').trim(),
          label: String(r.vname ?? '').trim(),
        }))
        .filter((r) => r.value && r.label)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      return NextResponse.json({ repairs });
    }
    return NextResponse.json({ rows: await listExceptionAccounts() });
  } catch (err) {
    console.error('[warranty-exceptions-api]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const originDenied = assertSameOriginMutation(req);
  if (originDenied) return originDenied;
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const body = (await req.json()) as Record<string, unknown>;
    const row = await upsertExceptionAccount(parseWrite(body));
    return NextResponse.json({ row });
  } catch (err) {
    console.error('[warranty-exceptions-api]', err);
    const msg = err instanceof Error && err.message.includes('unique')
      ? 'That system account is already configured'
      : toUserFacingError(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const originDenied = assertSameOriginMutation(req);
  if (originDenied) return originDenied;
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const body = (await req.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    const row = await upsertExceptionAccount(parseWrite(body), id);
    return NextResponse.json({ row });
  } catch (err) {
    console.error('[warranty-exceptions-api]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const originDenied = assertSameOriginMutation(req);
  if (originDenied) return originDenied;
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    await deleteExceptionAccount(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[warranty-exceptions-api]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
