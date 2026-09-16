import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { withAppClient } from '@/lib/read-model/db';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Math.floor(Number(searchParams.get('page') || 1) || 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 100)));
    const offset = (page - 1) * limit;
    const search = (searchParams.get('search') || '').trim();
    const filter = (searchParams.get('filter') || 'all').trim(); // 'all' | 'broken' | 'repeat3'
    const startDate = (searchParams.get('startDate') || '').trim();
    const endDate = (searchParams.get('endDate') || '').trim();
    const rawMinRepairs = searchParams.get('minRepairs');
    const minRepairs = rawMinRepairs !== null ? Math.max(1, Number(rawMinRepairs) || 1) : 2;

    return await withAppClient(async (client) => {
      // Query global stats for the filter tabs
      const statsRes = await client.query<{
        total_machines: number;
        broken_machines: number;
        repeat_machines: number;
        three_plus_machines: number;
      }>(`
        SELECT 
          (
            SELECT COUNT(*)::int FROM (
              SELECT serial_number FROM compressor_barcodes GROUP BY serial_number HAVING count(*) >= 2
            ) s2
          ) as repeat_machines,
          (
            SELECT COUNT(*)::int FROM (
              SELECT serial_number FROM compressor_barcodes GROUP BY serial_number HAVING count(*) >= 3
            ) s3
          ) as three_plus_machines,
          COUNT(DISTINCT serial_number) FILTER (WHERE is_continuity_broken = true)::int as broken_machines,
          COUNT(DISTINCT serial_number)::int as total_machines
        FROM compressor_barcodes;
      `);

      const stats = statsRes.rows[0] || {
        total_machines: 0,
        broken_machines: 0,
        repeat_machines: 0,
        three_plus_machines: 0,
      };

      // Build WHERE conditions based on filter, date range, minRepairs & search
      const conditions: string[] = [];
      const queryParams: unknown[] = [];

      if (filter === 'broken') {
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes WHERE is_continuity_broken = true
          )
        `);
      } else if (filter === 'repeat3') {
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes GROUP BY serial_number HAVING count(*) >= 3
          )
        `);
      } else if (minRepairs > 1) {
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes GROUP BY serial_number HAVING count(*) >= ${minRepairs}
          )
        `);
      }

      const dateTypeParam = (searchParams.get('dateType') || 'call_date').trim().toLowerCase();
      const dateColumn = dateTypeParam === 'solve_date' ? 'solve_date' : 'call_date';

      let dateConditionSql = '';
      if (startDate && endDate) {
        queryParams.push(startDate, endDate);
        const sIdx = queryParams.length - 1;
        const eIdx = queryParams.length;
        dateConditionSql = `${dateColumn} >= $${sIdx}::timestamptz AND ${dateColumn} <= ($${eIdx}::date + INTERVAL '1 day')`;
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE ${dateConditionSql}
          )
        `);
      } else if (startDate) {
        queryParams.push(startDate);
        const sIdx = queryParams.length;
        dateConditionSql = `${dateColumn} >= $${sIdx}::timestamptz`;
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE ${dateConditionSql}
          )
        `);
      } else if (endDate) {
        queryParams.push(endDate);
        const eIdx = queryParams.length;
        dateConditionSql = `${dateColumn} <= ($${eIdx}::date + INTERVAL '1 day')`;
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE ${dateConditionSql}
          )
        `);
      }

      if (search) {
        queryParams.push(`%${search}%`);
        const pIdx = queryParams.length;
        conditions.push(`
          serial_number IN (
            SELECT DISTINCT serial_number
            FROM compressor_barcodes
            WHERE serial_number ILIKE $${pIdx}
               OR call_no ILIKE $${pIdx}
               OR derived_old_barcode ILIKE $${pIdx}
               OR derived_new_barcode ILIKE $${pIdx}
               OR office_name ILIKE $${pIdx}
               OR branch_name ILIKE $${pIdx}
               OR sap_vendor_code ILIKE $${pIdx}
               OR old_item_code ILIKE $${pIdx}
               OR old_item_name ILIKE $${pIdx}
               OR new_item_code ILIKE $${pIdx}
               OR new_item_name ILIKE $${pIdx}
               OR call_status ILIKE $${pIdx}
               OR cancel_reason ILIKE $${pIdx}
          )
        `);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countQuery = `
        SELECT COUNT(DISTINCT serial_number)::int as total
        FROM compressor_barcodes
        ${whereClause}
      `;

      // Multi-sort: `sort=total_calls:desc,solve_date:asc` takes priority.
      // Falls back to legacy `sortBy` / `sortOrder` params.
      const SORT_SQL: Record<string, (dir: 'ASC' | 'DESC') => string> = {
        serial_number:  (d) => `serial_number ${d}`,
        total_calls:    (d) => `COUNT(*) ${d}`,
        avg_days_gap:   (d) => `ROUND(AVG(days_gap) FILTER (WHERE days_gap IS NOT NULL)) ${d} NULLS LAST`,
        current_barcode:(d) => `current_barcode ${d} NULLS LAST`,
        branch:         (d) => `latest_branch ${d} NULLS LAST`,
        office:         (d) => `latest_office ${d} NULLS LAST`,
        solve_date:     (d) => `MAX(solve_date) ${d} NULLS LAST`,
        call_date:      (d) => `MAX(call_date) ${d}`,
      };

      type SortKey = { field: string; dir: 'ASC' | 'DESC' };
      let sortKeys: SortKey[] = [];

      const sortParam = (searchParams.get('sort') || '').trim();
      if (sortParam) {
        sortKeys = sortParam
          .split(',')
          .map((s) => {
            const [field, rawDir] = s.trim().split(':');
            const dir = rawDir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            return { field: field?.trim() ?? '', dir };
          })
          .filter((k) => k.field in SORT_SQL) as SortKey[];
      }

      // Legacy fallback
      if (sortKeys.length === 0) {
        const legacyField = (searchParams.get('sortBy') || 'solve_date').trim();
        const legacyDir = (searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        if (legacyField in SORT_SQL) sortKeys = [{ field: legacyField, dir: legacyDir }];
      }

      const orderBySql = sortKeys.length > 0
        ? sortKeys.map((k) => SORT_SQL[k.field](k.dir)).join(', ')
        : 'MAX(COALESCE(solve_date, call_date)) DESC, serial_number ASC';

      const dataQuery = `
        SELECT 
          serial_number,
          COUNT(*)::int as total_calls,
          ${dateConditionSql ? `COUNT(*) FILTER (WHERE ${dateConditionSql})::int as calls_in_range,` : `COUNT(*)::int as calls_in_range,`}
          MAX(call_date) as latest_call_date,
          MAX(solve_date) as latest_solve_date,
          ROUND(AVG(days_gap) FILTER (WHERE days_gap IS NOT NULL))::int as avg_days_gap,
          (ARRAY_AGG(office_name ORDER BY call_date DESC))[1] as latest_office,
          (ARRAY_AGG(branch_name ORDER BY call_date DESC))[1] as latest_branch,
          (ARRAY_AGG(sap_vendor_code ORDER BY call_date DESC))[1] as latest_sap_vendor_code,
          BOOL_OR(is_continuity_broken) as has_continuity_break,
          COALESCE(
            (ARRAY_AGG(derived_new_barcode ORDER BY call_date DESC) FILTER (WHERE derived_new_barcode <> '-'))[1],
            '-'
          ) as current_barcode,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', id,
              'call_no', call_no,
              'call_date', call_date,
              'solve_date', solve_date,
              'days_gap', days_gap,
              'office_name', office_name,
              'branch_name', branch_name,
              'sap_vendor_code', sap_vendor_code,
              'old_item_code', old_item_code,
              'old_item_name', old_item_name,
              'new_item_code', new_item_code,
              'new_item_name', new_item_name,
              'derived_old_barcode', derived_old_barcode,
              'derived_new_barcode', derived_new_barcode,
              'call_status', call_status,
              'cancel_reason', cancel_reason,
              'is_continuity_broken', is_continuity_broken,
              'expected_old_barcode', expected_old_barcode
            ) ORDER BY call_date ASC
          ) ${dateConditionSql ? `FILTER (WHERE ${dateConditionSql})` : ''} as calls,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', id,
              'call_no', call_no,
              'call_date', call_date,
              'solve_date', solve_date,
              'days_gap', days_gap,
              'office_name', office_name,
              'branch_name', branch_name,
              'sap_vendor_code', sap_vendor_code,
              'old_item_code', old_item_code,
              'old_item_name', old_item_name,
              'new_item_code', new_item_code,
              'new_item_name', new_item_name,
              'derived_old_barcode', derived_old_barcode,
              'derived_new_barcode', derived_new_barcode,
              'call_status', call_status,
              'cancel_reason', cancel_reason,
              'is_continuity_broken', is_continuity_broken,
              'expected_old_barcode', expected_old_barcode
            ) ORDER BY call_date ASC
          ) as all_calls
        FROM compressor_barcodes
        ${whereClause}
        GROUP BY serial_number
        ORDER BY ${orderBySql}
        LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
      `;

      const [countRes, dataRes] = await Promise.all([
        client.query<{ total: number }>(countQuery, queryParams),
        client.query(dataQuery, [...queryParams, limit, offset]),
      ]);

      const total = countRes.rows[0]?.total ?? 0;
      const rows = dataRes.rows;

      return NextResponse.json({
        data: rows,
        total,
        page,
        limit,
        stats,
      });
    });
  } catch (err: unknown) {
    console.error('Compressor Barcodes API Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
