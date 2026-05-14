import { NextResponse } from 'next/server';

export async function POST() {
  // Synchronization has been completely disabled and migrated to real-time direct fetching.
  // This endpoint is kept alive purely for backwards compatibility with any lingering frontend clients.
  return NextResponse.json({ success: true, message: "Sync has been fully migrated to direct real-time." });
}
