import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/auth/require-page-access';

export default async function MisEmailRoutingPage() {
  await requirePageAccess('/admin/mis-email-routing');
  redirect('/admin/mis-email-settings?tab=routing');
}
