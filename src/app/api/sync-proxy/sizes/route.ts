import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { authorizeSyncProxy } from '@/lib/sync/proxy-auth';
import {
  ESSENTIAL_SYNC_TABLES,
  syncProxyCorsHeaders,
  syncProxyOptions,
} from '@/lib/sync/proxy-route';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import fs from 'fs';
import path from 'path';

export async function OPTIONS() {
  return syncProxyOptions();
}

export async function GET(request: Request) {
  const denied = await authorizeSyncProxy(request);
  if (denied) return denied;

  let schemaFileTableCount = 0;
  try {
    const schemaPath = path.join(process.cwd(), 'docs', 'WesternCRM Schema Architect.txt');
    if (fs.existsSync(schemaPath)) {
      const content = fs.readFileSync(schemaPath, 'utf-8');
      const matches = content.match(/CREATE TABLE/g);
      schemaFileTableCount = matches ? matches.length : 0;
    }
  } catch (err: unknown) {
    console.error('Error reading schema text file:', err instanceof Error ? err.message : err);
  }

  try {
    const catalogQuery = `
      SELECT 
        t.NAME AS TableName,
        SUM(p.rows) AS RowCounts,
        SUM(a.total_pages) * 8 AS TotalSpaceKB
      FROM 
        sys.tables t
      INNER JOIN      
        sys.indexes i ON t.object_id = i.object_id
      INNER JOIN 
        sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
      INNER JOIN 
        sys.allocation_units a ON p.partition_id = a.container_id
      WHERE 
        t.is_ms_shipped = 0
        AND i.object_id > 255 
      GROUP BY 
        t.Name
    `;

    try {
      const res = await postQuery({ rawSql: catalogQuery });
      if (res.data && res.data.length > 0) {
        const formatted = (res.data as Record<string, unknown>[]).map((row) => {
          const kb = Number(row.TotalSpaceKB || 0);
          const rows = Number(row.RowCounts || 0);
          const tableName = String(row.TableName ?? '');
          return {
            table: tableName,
            rows,
            sizeKB: kb,
            sizeMB: Number((kb / 1024).toFixed(2)),
            isEssential: ESSENTIAL_SYNC_TABLES.some(
              (t) => t === tableName.toLowerCase()
            ),
          };
        }).sort((a, b) => b.sizeKB - a.sizeKB);

        const totalMB = formatted.reduce((sum, item) => sum + item.sizeMB, 0);
        return NextResponse.json(
          {
            success: true,
            source: 'system_catalog',
            totalTables: formatted.length,
            totalSizeMB: Number(totalMB.toFixed(2)),
            schemaFileTableCount,
            tables: formatted,
          },
          { headers: syncProxyCorsHeaders }
        );
      }
    } catch (catError) {
      console.warn('System catalog query failed, falling back to COUNT(1):', catError);
    }

    const fallbackResults: Array<{
      table: string;
      rows: number;
      sizeKB: number;
      sizeMB: number;
      isEssential: boolean;
    }> = [];
    let totalMBEst = 0;

    for (const table of ESSENTIAL_SYNC_TABLES) {
      try {
        const res = await postQuery({
          fields: 'COUNT(1) as cnt',
          tableName: `${table} (NOLOCK)`,
        });
        const count = Number((res.data as Record<string, unknown>[])?.[0]?.cnt || 0);
        const estKB = count * 0.2;
        const estMB = Number((estKB / 1024).toFixed(2));
        totalMBEst += estMB;

        fallbackResults.push({
          table,
          rows: count,
          sizeKB: Math.round(estKB),
          sizeMB: estMB,
          isEssential: true,
        });
      } catch (err: unknown) {
        console.error(
          `Fallback failed for table ${table}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        source: 'row_counts_fallback',
        totalTables: fallbackResults.length,
        totalSizeMB: Number(totalMBEst.toFixed(2)),
        schemaFileTableCount,
        tables: fallbackResults.sort((a, b) => b.rows - a.rows),
      },
      { headers: syncProxyCorsHeaders }
    );
  } catch (error: unknown) {
    console.error('Failed to query sizes API:', error);
    return NextResponse.json(
      { error: toUserFacingError(error) },
      { status: 500, headers: syncProxyCorsHeaders }
    );
  }
}
