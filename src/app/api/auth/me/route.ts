import { NextResponse } from 'next/server';
import { getUserInfo } from '@/lib/auth/session';

export async function GET() {
  try {
    const userInfo = await getUserInfo();
    if (!userInfo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(userInfo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
