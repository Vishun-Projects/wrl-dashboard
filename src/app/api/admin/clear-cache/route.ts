import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
  try {

    
    // Truncate the table to remove all cached calls
    // Using executeRaw because deleteMany is slow for large datasets and might hit timeout
    await prisma.$executeRawUnsafe('TRUNCATE TABLE calls_cache RESTART IDENTITY CASCADE;');
    
    // Also clear comments if needed, or leave them for historical record?
    // User said "clear cache from our database", so probably everything related to calls.
    // However, comments are user-generated audit notes, so maybe keep them?
    // Actually, TRUNCATE ... CASCADE will handle it if there's a foreign key, 
    // but right now they are linked by call_id string.
    

    
    return NextResponse.json({ success: true, message: 'Database cache cleared successfully.' });
  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
