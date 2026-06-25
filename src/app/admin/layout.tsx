import { redirect } from 'next/navigation';
import { getUserInfo } from '@/lib/auth/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const userInfo = await getUserInfo();
  if (!userInfo) {
    redirect('/login');
  }
  return <>{children}</>;
}
