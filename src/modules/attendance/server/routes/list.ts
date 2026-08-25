import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { jsonSafeError } from '@/lib/api/safe-error';
import {
  buildAttendanceCsv,
  queryAttendanceExport,
  queryAttendanceList,
} from '@/sql/attendance/list';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function parseYmd(value: string | null, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
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
    const startDate = parseYmd(searchParams.get('startDate'), defaultStartDate());
    const endDate = parseYmd(searchParams.get('endDate'), defaultEndDate());
    const heading = searchParams.get('heading')?.trim() || 'All';
    const search = searchParams.get('search')?.trim() || '';
    const wantCsv = searchParams.get('export') === 'csv';

    if (wantCsv) {
      const { rows, truncated, total } = await queryAttendanceExport({
        startDate,
        endDate,
        heading,
        search,
      });
      const csv = buildAttendanceCsv(rows);
      const filename = `attendance_${startDate}_${endDate}.csv`;
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

    const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)
    );

    const result = await queryAttendanceList({
      startDate,
      endDate,
      heading,
      search,
      page,
      limit,
    });

    return NextResponse.json({
      ...result,
      page,
      limit,
      startDate,
      endDate,
      heading,
      search,
    });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load attendance activity');
  }
}
