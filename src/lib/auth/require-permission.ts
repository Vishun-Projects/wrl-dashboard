import 'server-only';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function getUserPermissionsOrEmpty(userId: string): Promise<string[]> {
  return prisma.getUserPermissions(userId);
}

/** Returns a 403 response if the user lacks every listed permission. */
export function forbiddenUnless(
  permissions: string[],
  ...required: string[]
): NextResponse | null {
  if (required.some((p) => permissions.includes(p))) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
