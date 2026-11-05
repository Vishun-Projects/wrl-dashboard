import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  fetchWarrantyProvisionOptions,
  queryWarrantyProvisionRows,
} from '@/modules/warranty-provision/server/store';
import { parseAsOf, querySnapReport } from '@/modules/warranty-provision/server/snap';
import { queryActiveUnitsByYear } from '@/modules/warranty-provision/server/active-units';
import {
  queryBreakdownMfgByYear,
  queryBreakdownMfgByYearCrmW,
  queryBreakdownMfgDetail,
  queryBreakdownMfgDetailCrmW,
} from '@/modules/warranty-provision/server/breakdown-mfg';
import {
  listMismatchFacts,
  resyncMismatchFacts,
} from '@/modules/warranty-provision/server/mismatch-facts';
import { fyStartYear, parsePeriodYm, todayIsoIst } from '@/modules/warranty-provision/fy';
import {
  buildActiveUnitsWorkbook,
  buildBreakdownDetailWorkbook,
  buildClaimsTemplateWorkbook,
  buildForecastWorkbook,
  buildMismatchWorkbook,
  buildSnapWorkbook,
  buildUnitsTemplateWorkbook,
} from '@/modules/warranty-provision/server/excel-export';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isSuperAdmin } from '@/lib/auth/rbac-catalog';
import {
  commitClaims,
  getAssumptions,
  listClaims,
  parseClaimsWorkbook,
  resyncClaimFacts,
  saveAssumptions,
} from '@/modules/warranty-provision/server/claims';
import {
  commitUnits,
  parseUnitsWorkbook,
} from '@/modules/warranty-provision/server/units-import';
import { queryWarrantyRates } from '@/modules/warranty-provision/server/rates';
import { queryWarrantyForecast } from '@/modules/warranty-provision/server/forecast';

export const runtime = 'nodejs';
export const maxDuration = 600;

function csvParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function snapParams(searchParams: URLSearchParams) {
  const asOf = parseAsOf(searchParams.get('asOf'));
  const fyFromRaw = searchParams.get('fyFrom');
  return {
    asOf,
    strict: searchParams.get('strict') === '1' || searchParams.get('strict') === 'true',
    fyFrom: fyFromRaw ? Number(fyFromRaw) : null,
    fyCount: Math.min(15, Math.max(1, Number(searchParams.get('fyCount') ?? 6) || 6)),
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'warranty_provision' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'rows';

    if (mode === 'options') {
      return NextResponse.json(await fetchWarrantyProvisionOptions());
    }

    if (mode === 'snap' || mode === 'snap-export') {
      const snap = await querySnapReport(snapParams(searchParams));
      if (mode === 'snap-export') {
        const buffer = await buildSnapWorkbook(snap);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="Warranty_SNAP_${snap.asOf}.xlsx"`,
          },
        });
      }
      return NextResponse.json(snap);
    }

    if (mode === 'active-units' || mode === 'active-units-export') {
      const data = await queryActiveUnitsByYear(parseAsOf(searchParams.get('asOf')));
      if (mode === 'active-units-export') {
        const buffer = await buildActiveUnitsWorkbook(data);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="Warranty_ActiveUnits_${data.asOf}.xlsx"`,
          },
        });
      }
      return NextResponse.json(data);
    }

    if (mode === 'breakdown-mfg') {
      const periodYm = searchParams.get('periodYm') ?? searchParams.get('asOf') ?? '';
      return NextResponse.json(await queryBreakdownMfgByYear(periodYm));
    }

    if (mode === 'breakdown-mfg-wco') {
      const periodYm = searchParams.get('periodYm') ?? searchParams.get('asOf') ?? '';
      return NextResponse.json(await queryBreakdownMfgByYearCrmW(periodYm));
    }

    if (
      mode === 'breakdown-mfg-detail' ||
      mode === 'breakdown-mfg-detail-export' ||
      mode === 'breakdown-mfg-wco-detail' ||
      mode === 'breakdown-mfg-wco-detail-export'
    ) {
      const periodYm = searchParams.get('periodYm') ?? searchParams.get('asOf') ?? '';
      const exportMode = mode.endsWith('-export');
      // UI drill always passes a 4-digit year; export may use year=ALL for full dump.
      const yearRaw = searchParams.get('year');
      const year = exportMode
        ? (yearRaw && yearRaw.trim() ? yearRaw : 'ALL')
        : (yearRaw ?? 'NA');
      const major = searchParams.get('major') ?? '';
      const crm = mode.includes('wco');
      const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(
        500,
        Math.max(1, Number(searchParams.get('pageSize') ?? 100) || 100)
      );
      const opts = exportMode ? { all: true as const } : { page, pageSize };
      const data = crm
        ? await queryBreakdownMfgDetailCrmW(periodYm, year, major, opts)
        : await queryBreakdownMfgDetail(periodYm, year, major, opts);
      if (exportMode) {
        const buffer = await buildBreakdownDetailWorkbook(data);
        const tag =
          data.majorFilter === 'major'
            ? '_Major'
            : data.majorFilter === 'minor'
              ? '_Minor'
              : '';
        const basis = crm ? 'CRM_WCO' : 'Active_WP';
        const yTag = data.yearKey === 'ALL' ? 'AllYears' : `Y${data.yearKey}`;
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="Warranty_BD_${basis}_${data.periodYm}_${yTag}${tag}.xlsx"`,
          },
        });
      }
      return NextResponse.json(data);
    }

    if (mode === 'breakdown-mismatch' || mode === 'breakdown-mismatch-export') {
      const periodYm = searchParams.get('periodYm') ?? searchParams.get('asOf') ?? '';
      const onlyRaw = (searchParams.get('onlyIn') ?? '').trim();
      const onlyIn = onlyRaw === 'wp' || onlyRaw === 'crm' ? onlyRaw : '';
      if (mode === 'breakdown-mismatch-export') {
        const data = await listMismatchFacts({ periodYm, onlyIn, all: true });
        const buffer = await buildMismatchWorkbook(data);
        const filter =
          onlyIn === 'wp' ? '_WP' : onlyIn === 'crm' ? '_CRM' : '';
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="Warranty_Mismatch_${data.periodYm}${filter}.xlsx"`,
          },
        });
      }
      const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(500, Math.max(1, Number(searchParams.get('pageSize') ?? 100) || 100));
      return NextResponse.json(
        await listMismatchFacts({ periodYm, onlyIn, page, pageSize })
      );
    }

    if (mode === 'rates') {
      return NextResponse.json(await queryWarrantyRates(snapParams(searchParams)));
    }

    if (mode === 'forecast' || mode === 'forecast-export') {
      const scenario = (searchParams.get('scenario') ?? 'base') as
        | 'base'
        | 'optimistic'
        | 'pessimistic';
      const forecast = await queryWarrantyForecast({ ...snapParams(searchParams), scenario });
      if (mode === 'forecast-export') {
        const buffer = await buildForecastWorkbook(forecast);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="Warranty_Forecast_${forecast.asOf}.xlsx"`,
          },
        });
      }
      return NextResponse.json(forecast);
    }

    if (mode === 'assumptions') {
      return NextResponse.json(await getAssumptions());
    }

    if (mode === 'units-template') {
      const buffer = await buildUnitsTemplateWorkbook();
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="Warranty_Units_Template.xlsx"',
        },
      });
    }

    if (mode === 'claims-template') {
      const buffer = await buildClaimsTemplateWorkbook();
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="Warranty_Claims_Template.xlsx"',
        },
      });
    }

    if (mode === 'claims') {
      const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50) || 50));
      const data = await listClaims({
        periodYm: searchParams.get('periodYm') ?? searchParams.get('asOf') ?? '',
        page,
        pageSize,
        q: (searchParams.get('q') ?? '').trim(),
      });
      return NextResponse.json(data);
    }

    if (mode === 'rows') {
      const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(1000, Math.max(1, Number(searchParams.get('pageSize') ?? 100) || 100));
      const statusRaw = (searchParams.get('status') ?? '').trim();
      const status =
        statusRaw === 'Active' || statusRaw === 'Inactive' ? statusRaw : ('' as const);
      const data = await queryWarrantyProvisionRows({
        materialGroups: csvParam(searchParams.get('materialGroups')),
        customerSubgroups: csvParam(searchParams.get('customerSubgroups')),
        states: csvParam(searchParams.get('states')),
        cities: csvParam(searchParams.get('cities')),
        materials: csvParam(searchParams.get('materials')),
        warrantyEndFys: csvParam(searchParams.get('warrantyEndFys')),
        status,
        q: (searchParams.get('q') ?? '').trim(),
        billingFrom: (searchParams.get('billingFrom') ?? '').trim(),
        billingTo: (searchParams.get('billingTo') ?? '').trim(),
        asOf: parseAsOf(searchParams.get('asOf')),
        page,
        pageSize,
      });
      return NextResponse.json(data);
    }

    if (mode === 'meta') {
      return NextResponse.json({
        today: todayIsoIst(),
        defaultFyFrom: fyStartYear(todayIsoIst()),
      });
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  } catch (err) {
    console.error('[warranty-provision GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const origin = assertSameOriginMutation(req);
    if (origin) return origin;

    const auth = await requireRbac(req, { pageId: 'warranty_provision' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? '';

    if (mode === 'assumptions') {
      const body = (await req.json()) as Record<string, unknown>;
      const saved = await saveAssumptions({
        inflationPct: body.inflationPct != null ? Number(body.inflationPct) : undefined,
        discountPct: body.discountPct != null ? Number(body.discountPct) : undefined,
        optimisticProbMult:
          body.optimisticProbMult != null ? Number(body.optimisticProbMult) : undefined,
        optimisticCostMult:
          body.optimisticCostMult != null ? Number(body.optimisticCostMult) : undefined,
        pessimisticProbMult:
          body.pessimisticProbMult != null ? Number(body.pessimisticProbMult) : undefined,
        pessimisticCostMult:
          body.pessimisticCostMult != null ? Number(body.pessimisticCostMult) : undefined,
        forecastStart:
          typeof body.forecastStart === 'string' ? body.forecastStart : undefined,
        includeFutureSales:
          typeof body.includeFutureSales === 'boolean' ? body.includeFutureSales : undefined,
        existingProvision:
          body.existingProvision != null ? Number(body.existingProvision) : undefined,
      });
      return NextResponse.json(saved);
    }

    // Parse + upsert in one shot (October-sized files — avoid JSON round-trip).
    if (mode === 'units-import') {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file' }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const parsed = await parseUnitsWorkbook(buf);
      if (!parsed.rows.length) {
        return NextResponse.json({
          upserted: 0,
          valid: 0,
          errorCount: parsed.errors.length,
          errors: parsed.errors.slice(0, 200),
        });
      }
      const result = await commitUnits(parsed.rows);
      return NextResponse.json({
        ...result,
        valid: parsed.rows.length,
        errorCount: parsed.errors.length,
        errors: parsed.errors.slice(0, 200),
        sample: parsed.rows.slice(0, 5),
      });
    }

    if (mode === 'claims-preview') {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file' }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const parsed = await parseClaimsWorkbook(buf);
      return NextResponse.json({
        valid: parsed.rows.length,
        errorCount: parsed.errors.length,
        errors: parsed.errors.slice(0, 200),
        sample: parsed.rows.slice(0, 5),
        rows: parsed.rows,
      });
    }

    if (mode === 'claims-commit') {
      const body = (await req.json()) as { rows?: unknown };
      if (!Array.isArray(body.rows)) {
        return NextResponse.json({ error: 'rows required' }, { status: 400 });
      }
      const result = await commitClaims(body.rows as Parameters<typeof commitClaims>[0]);
      return NextResponse.json(result);
    }

    if (mode === 'claims-resync') {
      const userAuth = await loadUserAuth(auth.userId);
      if (!isSuperAdmin(userAuth?.permissions)) {
        return NextResponse.json({ error: 'Superadmin only' }, { status: 403 });
      }
      const syncedBy =
        String(userAuth?.profile?.email ?? auth.userId).trim() || auth.userId;
      const body = (await req.json().catch(() => ({}))) as { periodYm?: string };
      const periodYm = parsePeriodYm(
        String(body.periodYm ?? searchParams.get('periodYm') ?? '').trim() ||
          todayIsoIst().slice(0, 7)
      );
      const meta = await resyncClaimFacts({ syncedBy });
      const mismatch = await resyncMismatchFacts({ syncedBy, periodYm });
      return NextResponse.json({ ...meta, mismatch });
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  } catch (err) {
    console.error('[warranty-provision POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
