import { NextRequest, NextResponse } from 'next/server';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { withAppClient } from '@/lib/read-model/db';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { buildDefaultSnapshot } from '@/modules/mb51-aging/server/fifo-from-db';
import {
  applySapVendorMasterToMb51,
  listSapVendorMaster,
  parseSapVendorMasterWorkbook,
  upsertSapVendorMaster,
} from '@/modules/mb51-aging/server/vendor-master';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function ensureTable() {
  await withAppClient(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS sap_vendor_master (
        vendor_code  text PRIMARY KEY,
        vendor_name  text NOT NULL DEFAULT '',
        valid_from   date,
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
  });
}

/** GET ?q=&page=&pageSize= — paginated vendor master list. */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'sap_vendor_master' });
    if (!auth.ok) return auth.response;
    await ensureTable();
    const sp = req.nextUrl.searchParams;
    const q = sp.get('q') ?? '';
    const page = Number(sp.get('page') || 1);
    const pageSize = Number(sp.get('pageSize') || 50);
    const result = await withAppClient((c) =>
      listSapVendorMaster(c, { q, page, pageSize })
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sap-vendor-master GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

/** PUT { vendorCode, vendorName, validFrom? } — create / update one vendor. */
export async function PUT(req: NextRequest) {
  const originDenied = assertSameOriginMutation(req);
  if (originDenied) return originDenied;
  try {
    const auth = await requireRbac(req, { pageId: 'sap_vendor_master' });
    if (!auth.ok) return auth.response;
    await ensureTable();
    const body = await req.json().catch(() => null);
    const vendorCode = String(body?.vendorCode ?? '').trim();
    const vendorName = String(body?.vendorName ?? '').trim();
    const validFrom = body?.validFrom ? String(body.validFrom).slice(0, 10) : null;
    if (!vendorCode) {
      return NextResponse.json({ error: 'Vendor code is required' }, { status: 400 });
    }
    await withAppClient(async (c) => {
      await upsertSapVendorMaster(c, [{ vendorCode, vendorName, validFrom }]);
      if (body?.applyToMb51) {
        await applySapVendorMasterToMb51(c);
      }
    });
    return NextResponse.json({ ok: true, vendorCode, vendorName });
  } catch (err) {
    console.error('[sap-vendor-master PUT]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

/** POST multipart file — upsert vendors from Vend Master.xlsx; overrides existing codes. */
export async function POST(req: NextRequest) {
  const originDenied = assertSameOriginMutation(req);
  if (originDenied) return originDenied;
  try {
    const auth = await requireRbac(req, { pageId: 'sap_vendor_master' });
    if (!auth.ok) return auth.response;
    await ensureTable();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    const applyToMb51 = String(form.get('applyToMb51') ?? '1') !== '0';
    const rebuildSnapshot = String(form.get('rebuildSnapshot') ?? '1') !== '0';

    const buf = Buffer.from(await file.arrayBuffer());
    const rows = await parseSapVendorMasterWorkbook(buf);
    if (!rows.length) {
      return NextResponse.json({ error: 'No vendor rows found in file' }, { status: 400 });
    }

    const upserted = await withAppClient(async (c) => {
      const n = await upsertSapVendorMaster(c, rows);
      let mb51Updated = 0;
      if (applyToMb51) mb51Updated = await applySapVendorMasterToMb51(c);
      return { n, mb51Updated };
    });

    let snapshotOk = false;
    if (rebuildSnapshot && applyToMb51) {
      try {
        const latest = await withAppClient(async (c) => {
          const res = await c.query<{ id: string }>(
            `SELECT id FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1`
          );
          return res.rows[0]?.id ?? null;
        });
        if (latest) {
          await buildDefaultSnapshot(latest);
          snapshotOk = true;
        }
      } catch (err) {
        console.error('[sap-vendor-master] snapshot rebuild failed', err);
      }
    }

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      parsed: rows.length,
      upserted: upserted.n,
      mb51Updated: upserted.mb51Updated,
      snapshotOk,
    });
  } catch (err) {
    console.error('[sap-vendor-master POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
