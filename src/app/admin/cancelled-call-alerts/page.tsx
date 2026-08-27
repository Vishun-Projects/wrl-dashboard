import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/auth/require-page-access';

export default async function CancelledCallAlertsPage() {
  await requirePageAccess('/admin/cancelled-call-alerts');
  redirect('/admin/mis-email-settings?tab=cancelled');
}
