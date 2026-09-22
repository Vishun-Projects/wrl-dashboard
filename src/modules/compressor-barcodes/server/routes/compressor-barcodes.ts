import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { withAppClient } from '@/lib/read-model/db';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  compressorBranchScopeClause,
  resolveAllowedCompressorBranchNames,
} from '@/modules/compressor-barcodes/server/office-scope';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'compressor_barcodes' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Math.floor(Number(searchParams.get('page') || 1) || 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 100)));
    const offset = (page - 1) * limit;
    const search = (searchParams.get('search') || '').trim();
    const filter = (searchParams.get('filter') || 'all').trim(); // 'all' | 'broken' | 'repeat3' | 'premature'
    let branch = (searchParams.get('branch') || '').trim();
    const startDate = (searchParams.get('startDate') || '').trim();
    const endDate = (searchParams.get('endDate') || '').trim();
    const rawMinRepairs = searchParams.get('minRepairs');
    const minRepairs = rawMinRepairs !== null ? Math.max(1, Number(rawMinRepairs) || 1) : 2;

    const format = (searchParams.get('format') || '').trim().toLowerCase();
    const isExport =
      format === 'csv' ||
      searchParams.get('export') === 'csv' ||
      searchParams.get('export') === 'true';

    return await withAppClient(async (client) => {
      const allowedNames = await resolveAllowedCompressorBranchNames(
        client,
        auth.security.isHod,
        auth.security.assignedOffices
      );

      // Forged / out-of-scope branch → empty result set
      if (branch && allowedNames != null && !allowedNames.includes(branch)) {
        branch = '__out_of_scope__';
      }

      const scope0 = compressorBranchScopeClause(allowedNames, 1);
      const scopeSql = scope0.sql;
      const scopeParams = scope0.values;

      // Query scoped stats, top repeat branches, and distinct branches in parallel
      // NOTE: Cancelled calls must NEVER be counted as repairs or towards repeat machines.
      const [statsRes, topBranchesRes, allBranchesRes] = await Promise.all([
        client.query<{
          total_machines: number;
          broken_machines: number;
          repeat_machines: number;
          three_plus_machines: number;
          premature_machines: number;
        }>(
          `
          SELECT 
            (
              SELECT COUNT(*)::int FROM (
                SELECT serial_number 
                FROM compressor_barcodes 
                WHERE call_status IS DISTINCT FROM 'Cancelled'
                ${scopeSql}
                GROUP BY serial_number 
                HAVING count(*) >= 2
              ) s2
            ) as repeat_machines,
            (
              SELECT COUNT(*)::int FROM (
                SELECT serial_number 
                FROM compressor_barcodes 
                WHERE call_status IS DISTINCT FROM 'Cancelled'
                ${scopeSql}
                GROUP BY serial_number 
                HAVING count(*) >= 3
              ) s3
            ) as three_plus_machines,
            (
              SELECT COUNT(DISTINCT serial_number)::int 
              FROM compressor_barcodes 
              WHERE days_gap IS NOT NULL 
                AND days_gap <= 90
                AND call_status IS DISTINCT FROM 'Cancelled'
                ${scopeSql}
            ) as premature_machines,
            COUNT(DISTINCT serial_number) FILTER (WHERE is_continuity_broken = true AND call_status IS DISTINCT FROM 'Cancelled')::int as broken_machines,
            COUNT(DISTINCT serial_number) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled')::int as total_machines
          FROM compressor_barcodes
          WHERE call_status IS DISTINCT FROM 'Cancelled'
          ${scopeSql}
        `,
          scopeParams
        ),
        client.query<{ branch_name: string; repeat_count: number }>(
          `
          SELECT 
            branch_name, 
            COUNT(DISTINCT serial_number)::int as repeat_count
          FROM compressor_barcodes
          WHERE branch_name IS NOT NULL AND branch_name <> ''
            AND call_status IS DISTINCT FROM 'Cancelled'
            ${scopeSql}
            AND serial_number IN (
              SELECT serial_number 
              FROM compressor_barcodes 
              WHERE call_status IS DISTINCT FROM 'Cancelled'
              ${scopeSql}
              GROUP BY serial_number 
              HAVING COUNT(*) >= 2
            )
          GROUP BY branch_name
          ORDER BY repeat_count DESC
          LIMIT 8;
        `,
          // same $1 used twice in nested subquery — only one param needed
          scopeParams
        ),
        client.query<{ branch_name: string }>(
          `
          SELECT DISTINCT branch_name
          FROM compressor_barcodes
          WHERE branch_name IS NOT NULL AND branch_name <> ''
            AND call_status IS DISTINCT FROM 'Cancelled'
            ${scopeSql}
          ORDER BY branch_name ASC;
        `,
          scopeParams
        ),
      ]);

      const stats = {
        ...(statsRes.rows[0] || {
          total_machines: 0,
          broken_machines: 0,
          repeat_machines: 0,
          three_plus_machines: 0,
          premature_machines: 0,
        }),
        top_branches: topBranchesRes.rows,
        all_branches: allBranchesRes.rows.map((r) => r.branch_name),
      };

      // Build WHERE conditions based on filter, branch, date range, minRepairs & search
      const conditions: string[] = [];
      const queryParams: unknown[] = [];

      const pushScope = () => {
        if (allowedNames == null) return '';
        queryParams.push(allowedNames);
        return ` AND branch_name = ANY($${queryParams.length}::text[])`;
      };

      // Base: non-cancelled repairs, scoped to allowed branches
      {
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes
            WHERE call_status IS DISTINCT FROM 'Cancelled'${s}
          )
        `);
      }

      // Row-level scope so aggregations only see in-scope call rows
      if (allowedNames != null) {
        queryParams.push(allowedNames);
        conditions.push(`branch_name = ANY($${queryParams.length}::text[])`);
      }

      if (filter === 'broken') {
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE is_continuity_broken = true AND call_status IS DISTINCT FROM 'Cancelled'${s}
          )
        `);
      } else if (filter === 'repeat3') {
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE call_status IS DISTINCT FROM 'Cancelled'${s}
            GROUP BY serial_number HAVING count(*) >= 3
          )
        `);
      } else if (filter === 'premature') {
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE days_gap IS NOT NULL AND days_gap <= 90 AND call_status IS DISTINCT FROM 'Cancelled'${s}
          )
        `);
      } else if (minRepairs > 1) {
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE call_status IS DISTINCT FROM 'Cancelled'${s}
            GROUP BY serial_number HAVING count(*) >= ${minRepairs}
          )
        `);
      }

      if (branch) {
        queryParams.push(branch);
        const bIdx = queryParams.length;
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE branch_name = $${bIdx} AND call_status IS DISTINCT FROM 'Cancelled'${s}
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
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE ${dateConditionSql} AND call_status IS DISTINCT FROM 'Cancelled'${s}
          )
        `);
      } else if (startDate) {
        queryParams.push(startDate);
        const sIdx = queryParams.length;
        dateConditionSql = `${dateColumn} >= $${sIdx}::timestamptz`;
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE ${dateConditionSql} AND call_status IS DISTINCT FROM 'Cancelled'${s}
          )
        `);
      } else if (endDate) {
        queryParams.push(endDate);
        const eIdx = queryParams.length;
        dateConditionSql = `${dateColumn} <= ($${eIdx}::date + INTERVAL '1 day')`;
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT serial_number FROM compressor_barcodes 
            WHERE ${dateConditionSql} AND call_status IS DISTINCT FROM 'Cancelled'${s}
          )
        `);
      }

      if (search) {
        queryParams.push(`%${search}%`);
        const pIdx = queryParams.length;
        const s = pushScope();
        conditions.push(`
          serial_number IN (
            SELECT DISTINCT serial_number
            FROM compressor_barcodes
            WHERE (
              serial_number ILIKE $${pIdx}
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
            )${s}
          )
        `);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Multi-sort: `sort=total_calls:desc,solve_date:asc` takes priority.
      // Falls back to legacy `sortBy` / `sortOrder` params.
      // Cancelled calls are ignored when aggregating sort metrics.
      const SORT_SQL: Record<string, (dir: 'ASC' | 'DESC') => string> = {
        serial_number: (d) => `serial_number ${d}`,
        total_calls: (d) =>
          `COUNT(*) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') ${d}`,
        avg_days_gap: (d) =>
          `ROUND(AVG(days_gap) FILTER (WHERE days_gap IS NOT NULL AND call_status IS DISTINCT FROM 'Cancelled')) ${d} NULLS LAST`,
        current_barcode: (d) =>
          `COALESCE((ARRAY_AGG(derived_new_barcode ORDER BY call_date DESC) FILTER (WHERE derived_new_barcode <> '-' AND call_status IS DISTINCT FROM 'Cancelled'))[1], '-') ${d} NULLS LAST`,
        branch: (d) =>
          `(ARRAY_AGG(branch_name ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] ${d} NULLS LAST`,
        office: (d) =>
          `(ARRAY_AGG(office_name ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] ${d} NULLS LAST`,
        solve_date: (d) =>
          `MAX(solve_date) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') ${d} NULLS LAST`,
        call_date: (d) =>
          `MAX(call_date) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') ${d}`,
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

      if (sortKeys.length === 0) {
        const legacyField = (searchParams.get('sortBy') || 'solve_date').trim();
        const legacyDir =
          (searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        if (legacyField in SORT_SQL) sortKeys = [{ field: legacyField, dir: legacyDir }];
      }

      const orderBySql =
        sortKeys.length > 0
          ? sortKeys.map((k) => SORT_SQL[k.field](k.dir)).join(', ')
          : "MAX(COALESCE(solve_date, call_date)) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') DESC NULLS LAST, serial_number ASC";

      if (isExport) {
        const exportQuery = `
          SELECT 
            serial_number,
            COUNT(*) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled')::int as total_calls,
            ${dateConditionSql ? `COUNT(*) FILTER (WHERE ${dateConditionSql} AND call_status IS DISTINCT FROM 'Cancelled')::int as calls_in_range,` : `COUNT(*) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled')::int as calls_in_range,`}
            MAX(call_date) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') as latest_call_date,
            MAX(solve_date) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') as latest_solve_date,
            ROUND(AVG(days_gap) FILTER (WHERE days_gap IS NOT NULL AND call_status IS DISTINCT FROM 'Cancelled'))::int as avg_days_gap,
            (ARRAY_AGG(office_name ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] as latest_office,
            (ARRAY_AGG(branch_name ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] as latest_branch,
            (ARRAY_AGG(sap_vendor_code ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] as latest_sap_vendor_code,
            BOOL_OR(is_continuity_broken AND call_status IS DISTINCT FROM 'Cancelled') as has_continuity_break,
            COALESCE(
              (ARRAY_AGG(derived_new_barcode ORDER BY call_date DESC) FILTER (WHERE derived_new_barcode <> '-' AND call_status IS DISTINCT FROM 'Cancelled'))[1],
              '-'
            ) as current_barcode
          FROM compressor_barcodes
          ${whereClause}
          GROUP BY serial_number
          ORDER BY ${orderBySql}
        `;

        const exportRes = await client.query<{
          serial_number: string;
          total_calls: number;
          calls_in_range: number;
          latest_call_date: string | null;
          latest_solve_date: string | null;
          avg_days_gap: number | null;
          latest_office: string | null;
          latest_branch: string | null;
          latest_sap_vendor_code: string | null;
          has_continuity_break: boolean;
          current_barcode: string | null;
        }>(exportQuery, queryParams);

        const headers = [
          'Serial Number',
          'Total Repairs',
          'Avg Days Gap (Days)',
          'Current Barcode',
          'Branch',
          'Latest Office / Workshop',
          'SAP Vendor Code',
          'Latest Solved Date',
          'Latest Call Date',
          'Has Continuity Break',
        ];

        const csvRows = [
          headers.join(','),
          ...exportRes.rows.map((row) =>
            [
              row.serial_number || '',
              row.total_calls ?? 0,
              row.avg_days_gap ?? '',
              row.current_barcode ?? '',
              row.latest_branch ?? '',
              row.latest_office ?? '',
              row.latest_sap_vendor_code ?? '',
              row.latest_solve_date
                ? new Date(row.latest_solve_date).toISOString().slice(0, 10)
                : '',
              row.latest_call_date
                ? new Date(row.latest_call_date).toISOString().slice(0, 10)
                : '',
              row.has_continuity_break ? 'YES' : 'NO',
            ]
              .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
              .join(',')
          ),
        ];

        const csvContent = csvRows.join('\r\n');
        const filename = `compressor_barcodes_${new Date().toISOString().slice(0, 10)}.csv`;

        return new NextResponse(csvContent, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      }

      const countQuery = `
        SELECT COUNT(DISTINCT serial_number)::int as total
        FROM compressor_barcodes
        ${whereClause}
      `;

      const dataQuery = `
        SELECT 
          serial_number,
          COUNT(*) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled')::int as total_calls,
          ${dateConditionSql ? `COUNT(*) FILTER (WHERE ${dateConditionSql} AND call_status IS DISTINCT FROM 'Cancelled')::int as calls_in_range,` : `COUNT(*) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled')::int as calls_in_range,`}
          MAX(call_date) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') as latest_call_date,
          MAX(solve_date) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled') as latest_solve_date,
          ROUND(AVG(days_gap) FILTER (WHERE days_gap IS NOT NULL AND call_status IS DISTINCT FROM 'Cancelled'))::int as avg_days_gap,
          (ARRAY_AGG(office_name ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] as latest_office,
          (ARRAY_AGG(branch_name ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] as latest_branch,
          (ARRAY_AGG(sap_vendor_code ORDER BY call_date DESC) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled'))[1] as latest_sap_vendor_code,
          BOOL_OR(is_continuity_broken AND call_status IS DISTINCT FROM 'Cancelled') as has_continuity_break,
          COALESCE(
            (ARRAY_AGG(derived_new_barcode ORDER BY call_date DESC) FILTER (WHERE derived_new_barcode <> '-' AND call_status IS DISTINCT FROM 'Cancelled'))[1],
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
