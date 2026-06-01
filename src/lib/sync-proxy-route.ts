import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import { authorizeSyncProxy } from '@/lib/sync-proxy-auth';
import { clampSyncProxyLimit } from '@/lib/report-limits';
import fs from 'fs';
import path from 'path';

export const ESSENTIAL_SYNC_TABLES = [
  'trhcalls',
  'mstoffice',
  'mstusers',
  'mstparty',
  'mstcity',
  'mststate',
  'trdcalls2fault',
  'mstrepair',
  'trdcalls3parts',
  'mstcallcancelreasons',
  'mstfixedselection',
] as const;

export const syncProxyCorsHeaders = {
  'Access-Control-Allow-Origin': process.env.SYNC_PROXY_CORS_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function syncProxyOptions(): Response {
  return new Response(null, { status: 204, headers: syncProxyCorsHeaders });
}

export async function handleSyncProxyGet(
  request: Request,
  table: string
): Promise<Response> {
  const denied = await authorizeSyncProxy(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);

  if (table === 'tables') {
    return NextResponse.json([...ESSENTIAL_SYNC_TABLES], { headers: syncProxyCorsHeaders });
  }

  if (table === 'schema-file') {
    const schemaPath = path.join(process.cwd(), 'docs', 'WesternCRM Schema Architect.txt');
    if (!fs.existsSync(schemaPath)) {
      return NextResponse.json(
        { error: 'Schema file not found' },
        { status: 404, headers: syncProxyCorsHeaders }
      );
    }
    const content = fs.readFileSync(schemaPath, 'utf-8');
    return new Response(content, {
      headers: {
        ...syncProxyCorsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="WesternCRM_Schema_Blueprint.sql"',
      },
    });
  }

  const tableLower = table.toLowerCase();
  if (!ESSENTIAL_SYNC_TABLES.some((t) => t === tableLower)) {
    return NextResponse.json({ error: 'Table not allowed' }, { status: 400, headers: syncProxyCorsHeaders });
  }

  const limit = clampSyncProxyLimit(parseInt(searchParams.get('limit') || '500', 10));
  const afterId = searchParams.get('after_id');

  let condition = '1=1';
  const orderBy = 'ncode ASC';

  if (afterId && afterId !== 'null' && afterId !== 'undefined') {
    if (/^\d+$/.test(afterId)) {
      condition = `ncode > ${afterId}`;
    } else {
      condition = `ncode > '${afterId.replace(/'/g, "''")}'`;
    }
  }

  const result = await postQuery({
    top: String(limit),
    fields: '*',
    tableName: `${table} (NOLOCK)`,
    condition,
    orderBy,
  });

  const rows = (result.data || []) as Record<string, unknown>[];
  const mappedRows = rows.map((row) => {
    const mapped = { ...row };
    if (row.ncode !== undefined && mapped.id === undefined) {
      mapped.id = Number(row.ncode);
    }
    return mapped;
  });

  return NextResponse.json(mappedRows, { headers: syncProxyCorsHeaders });
}
