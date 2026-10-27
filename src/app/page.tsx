import { redirect } from 'next/navigation';
import { getUserInfo } from '@/lib/auth/session';
import { defaultLandingPath } from '@/lib/auth/rbac-catalog';

export default async function Home() {
  const user = await getUserInfo();
  redirect(user ? defaultLandingPath(user.permissions) : '/login');
}
