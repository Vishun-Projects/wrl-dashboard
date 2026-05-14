import { NextResponse } from 'next/server';

export async function GET() {
  // Synchronization has been completely disabled and migrated to real-time direct fetching.
  // This endpoint returns a dummy completed status to avoid breaking any lingering frontend polling.
  return NextResponse.json({
    is_running: false,
    progress: 100,
    current_step: 'Real-time Mode Active',
    total_records: 0
  });
}
