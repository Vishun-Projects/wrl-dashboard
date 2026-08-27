import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { jsonSafeError } from '@/lib/api/safe-error';
import { getAttendanceSettings } from '@/modules/attendance/services/org-settings';
import {
  type ActivityHeaderFilterField,
  buildActivityReportCsv,
  queryActivityReport,
  queryActivityReportDistinctCallTypes,
  queryActivityReportDistinctHeaderValues,
  queryActivityReportExport,
  queryAttendanceOfficeOptions,
  queryRelatedActivities,
  type SearchBy,
} from '@/sql/attendance/activity-report';

function parseYmd(value: string | null, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function parseOptionalYmd(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parsePage(value: string | null, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.trunc(n);
}

function parsePageSize(value: string | null, fallback = 10): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(100, Math.trunc(n));
}

function parseOfficeIds(value: string | null): number[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

function parseCallTypes(value: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function parseCsvStrings(value: string | null): string[] {
  return parseCallTypes(value);
}

function parseHeaderField(value: string | null): ActivityHeaderFilterField | null {
  const v = String(value ?? '').trim();
  if (
    v === 'office' ||
    v === 'technician' ||
    v === 'call_no' ||
    v === 'call_type' ||
    v === 'serial' ||
    v === 'repair_done'
  ) {
    return v;
  }
  return null;
}

function parseSearchBy(value: string | null): SearchBy | '' {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (v === 'call' || v === 'serial' || v === 'call_number' || v === 'office' || v === 'technician') {
    return v;
  }
  return '';
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  if (!auth?.permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const activityDateFrom = parseYmd(
      searchParams.get('activityDateFrom') ?? searchParams.get('startDate'),
      defaultStartDate()
    );
    const activityDateTo = parseYmd(
      searchParams.get('activityDateTo') ?? searchParams.get('endDate'),
      defaultEndDate()
    );
    const callDateFrom = parseOptionalYmd(searchParams.get('callDateFrom'));
    const callDateTo = parseOptionalYmd(searchParams.get('callDateTo'));
    const searchBy = parseSearchBy(searchParams.get('searchBy'));
    const q = searchParams.get('q')?.trim() || searchParams.get('search')?.trim() || '';
    const officeIds = parseOfficeIds(searchParams.get('officeIds'));
    const callTypes = parseCallTypes(searchParams.get('callTypes'));
    const officeNames = parseCsvStrings(
      searchParams.get('officeNames') ?? searchParams.get('officeName')
    );
    const technicianNames = parseCsvStrings(
      searchParams.get('technicianNames') ?? searchParams.get('technicianName')
    );
    const callNos = parseCsvStrings(searchParams.get('callNos') ?? searchParams.get('callNo'));
    const serialNos = parseCsvStrings(
      searchParams.get('serialNos') ?? searchParams.get('serialNo')
    );
    const repairDones = parseCsvStrings(
      searchParams.get('repairDones') ?? searchParams.get('repairDone')
    );
    const page = parsePage(searchParams.get('page'));
    const pageSize = parsePageSize(searchParams.get('pageSize') ?? searchParams.get('limit'));
    const wantCsv = searchParams.get('export') === 'csv';
    const wantOffices = searchParams.get('meta') === 'offices';
    const wantCallTypes = searchParams.get('meta') === 'callTypes';
    const wantHeaderValues = searchParams.get('meta') === 'headerValues';
    const headerField = parseHeaderField(searchParams.get('field'));
    const relatedUserId = Number(searchParams.get('relatedUserId'));
    const relatedDay = parseOptionalYmd(searchParams.get('relatedDay'));
    const relatedAttdUser = searchParams.get('relatedAttdUser')?.trim() || '';

    const settings = await getAttendanceSettings();

    if (wantOffices) {
      const offices = await queryAttendanceOfficeOptions(activityDateFrom, activityDateTo);
      return NextResponse.json({ offices, settings });
    }

    if (wantCallTypes) {
      const callTypes = await queryActivityReportDistinctCallTypes({
        searchBy,
        q,
        officeIds,
        callDateFrom,
        callDateTo,
        activityDateFrom,
        activityDateTo,
      });
      return NextResponse.json({ callTypes, settings });
    }
    if (wantHeaderValues && headerField) {
      const values = await queryActivityReportDistinctHeaderValues(
        {
          searchBy,
          q,
          officeIds,
          callTypes,
          officeNames,
          technicianNames,
          callNos,
          serialNos,
          repairDones,
          callDateFrom,
          callDateTo,
          activityDateFrom,
          activityDateTo,
        },
        headerField
      );
      return NextResponse.json({ values, field: headerField, settings });
    }

    if (
      Number.isFinite(relatedUserId) &&
      relatedUserId > 0 &&
      relatedDay
    ) {
      const related = await queryRelatedActivities({
        userId: Math.trunc(relatedUserId),
        day: relatedDay,
        attdUser: relatedAttdUser || null,
      });
      return NextResponse.json({ related, settings });
    }

    const filterParams = {
      searchBy,
      q,
      officeIds,
      callTypes,
      officeNames,
      technicianNames,
      callNos,
      serialNos,
      repairDones,
      callDateFrom,
      callDateTo,
      activityDateFrom,
      activityDateTo,
    };

    if (wantCsv) {
      const { rows, truncated, total } = await queryActivityReportExport(filterParams, settings);
      const csv = buildActivityReportCsv(rows);
      const filename = `service_call_activity_${activityDateFrom}_${activityDateTo}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Export-Row-Count': String(rows.length),
          'X-Export-Total': String(total),
          'X-Export-Truncated': truncated ? '1' : '0',
        },
      });
    }

    const { total, rows } = await queryActivityReport(
      { ...filterParams, page, pageSize },
      settings
    );

    return NextResponse.json({
      rows,
      total,
      page,
      pageSize,
      settings,
      filters: {
        searchBy,
        q,
        officeIds,
        callTypes,
        callDateFrom: callDateFrom ?? null,
        callDateTo: callDateTo ?? null,
        activityDateFrom,
        activityDateTo,
      },
    });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load activity report');
  }
}
