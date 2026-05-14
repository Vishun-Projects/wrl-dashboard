import { NextResponse } from 'next/server';

export async function GET() {
  // Synchronization has been completely disabled and migrated to real-time direct fetching.
  // This endpoint is kept alive purely for backwards compatibility.
  return NextResponse.json({ success: true, message: "Sync endpoint disabled. App is running in Real-time Direct Mode." });
}
