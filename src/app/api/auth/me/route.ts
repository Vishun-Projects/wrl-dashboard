import { NextResponse } from 'next/server';
import { getUserInfo } from '@/lib/auth/session';

export async function GET() {
  try {
    const userInfo = await getUserInfo();
    if (!userInfo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(userInfo);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load profile';
    console.error('[api/auth/me]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
