import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import fs from 'fs';
import path from 'path';

// List of essential tables that our dashboard uses and needs to mirror
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ table: string }> }
) {
  try {
    const { table } = await params;
    const { searchParams } = new URL(request.url);

    // 1. Handshake/Table list endpoint
    if (table === 'tables') {
      return NextResponse.json(ESSENTIAL_TABLES, { headers: corsHeaders });
    }

    // 2. Stream database schema blueprint file as SQL
    if (table === 'schema-file') {
      try {
        const schemaPath = path.join(process.cwd(), 'docs', 'WesternCRM Schema Architect.txt');
        if (fs.existsSync(schemaPath)) {
          const content = fs.readFileSync(schemaPath, 'utf-8');
          return new Response(content, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Disposition': 'attachment; filename="WesternCRM_Schema_Blueprint.sql"'
            }
          });
        } else {
          return NextResponse.json({ error: 'Schema file not found' }, { status: 404, headers: corsHeaders });
        }
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 2. Fetch rows from the specified table
    const limit = parseInt(searchParams.get('limit') || '500');
    const afterId = searchParams.get('after_id'); // the cursor representing last fetched ncode

    let condition = '1=1';
    let orderBy = 'ncode ASC';

    // Build the query to fetch rows ordered by ncode
    if (afterId && afterId !== 'null' && afterId !== 'undefined') {
      // If cursor is a number (typical for ncode), query directly, otherwise treat as string
      if (/^\d+$/.test(afterId)) {
        condition = `ncode > ${afterId}`;
      } else {
        condition = `ncode > '${afterId.replace(/'/g, "''")}'`;
      }
    }

    // Execute the query on WesternDB
    const result = await postQuery({
      top: String(limit),
      fields: '*',
      tableName: `${table} (NOLOCK)`,
      condition,
      orderBy
    });

    const rows = result.data || [];

    // Map rows so they are ready for Supabase JSON upsert
    // Since SQL Server might return PascalCase column names, keep them, but ensure
    // each row has a lowercase 'id' key mapping to 'ncode' so the sync tool's cursor works.
    const mappedRows = rows.map((row: any) => {
      const mapped = { ...row };
      if (row.ncode !== undefined && row.id === undefined) {
        mapped.id = Number(row.ncode);
      }
      return mapped;
    });

    return NextResponse.json(mappedRows, { headers: corsHeaders });

  } catch (error: any) {
    console.error(`Sync Proxy Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

