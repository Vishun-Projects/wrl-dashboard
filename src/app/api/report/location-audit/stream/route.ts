import { NextResponse } from 'next/server';

/** @deprecated Use GET /api/report/location-audit?mode=summary|list|row instead. */
export async function GET() {
  return NextResponse.json(
    {
      error:
        'Streaming audit is disabled. Use Run audit on the Location Audit page (summary + paginated list).',
    },
    { status: 410 }
  );
}
