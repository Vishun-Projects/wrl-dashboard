import { NextRequest } from 'next/server';
import { handleRegisterGet } from '@/lib/register/server';

/** Bulk preload can scan the full hot table for a month — allow up to 5 minutes on serverless. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return handleRegisterGet(req);
}
