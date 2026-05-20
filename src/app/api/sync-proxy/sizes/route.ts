import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import fs from 'fs';
import path from 'path';

const ESSENTIAL_TABLES = [
  "trhcalls",
  "mstoffice",
  "mstusers",
  "mstparty",
  "mstcity",
  "mststate",
  "trdcalls2fault",
  "mstrepair",
  "trdcalls3parts",
  "mstcallcancelreasons",
  "mstfixedselection"
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET() {
  let schemaFileTableCount = 0;
  try {
    const schemaPath = path.join(process.cwd(), 'docs', 'WesternCRM Schema Architect.txt');
    if (fs.existsSync(schemaPath)) {
      const content = fs.readFileSync(schemaPath, 'utf-8');
      const matches = content.match(/CREATE TABLE/g);
      schemaFileTableCount = matches ? matches.length : 0;
    }
  } catch (err: any) {
    console.error("Error reading schema text file:", err.message);
  }

  try {
    // 1. Try querying the SQL Server system catalog for actual table space and row counts
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
        const formatted = res.data.map((row: any) => {
          const kb = Number(row.TotalSpaceKB || 0);
          const rows = Number(row.RowCounts || 0);
          return {
            table: row.TableName,
            rows,
            sizeKB: kb,
            sizeMB: Number((kb / 1024).toFixed(2)),
            isEssential: ESSENTIAL_TABLES.includes(row.TableName.toLowerCase())
          };
        }).sort((a, b) => b.sizeKB - a.sizeKB);

        const totalMB = formatted.reduce((sum, item) => sum + item.sizeMB, 0);
        return NextResponse.json({
          success: true,
          source: 'system_catalog',
          totalTables: formatted.length,
          totalSizeMB: Number(totalMB.toFixed(2)),
          schemaFileTableCount,
          tables: formatted
        }, { headers: corsHeaders });
      }
    } catch (catError) {
      console.warn("System catalog query failed, falling back to COUNT(1):", catError);
    }

    // 2. Fallback: Query COUNT(1) for our essential tables if system catalogs are restricted
    const fallbackResults = [];
    let totalMBEst = 0;

    for (const table of ESSENTIAL_TABLES) {
      try {
        const res = await postQuery({
          fields: "COUNT(1) as cnt",
          tableName: `${table} (NOLOCK)`
        });
        const count = Number(res.data?.[0]?.cnt || 0);
        // Estimate 0.2 KB per row as a very conservative average
        const estKB = count * 0.2;
        const estMB = Number((estKB / 1024).toFixed(2));
        totalMBEst += estMB;
        
        fallbackResults.push({
          table,
          rows: count,
          sizeKB: Math.round(estKB),
          sizeMB: estMB,
          isEssential: true
        });
      } catch (err: any) {
        console.error(`Fallback failed for table ${table}:`, err.message);
      }
    }

    return NextResponse.json({
      success: true,
      source: 'row_counts_fallback',
      totalTables: fallbackResults.length,
      totalSizeMB: Number(totalMBEst.toFixed(2)),
      schemaFileTableCount,
      tables: fallbackResults.sort((a, b) => b.rows - a.rows)
    }, { headers: corsHeaders });

  } catch (error: any) {
    console.error("Failed to query sizes API:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

