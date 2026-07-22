import { requirePageAccess } from '@/lib/auth/require-page-access';
import MisEmailRoutingPageClient from '@/features/mis-email/ui/MisEmailRoutingPageClient';

export default async function MisEmailRoutingPage() {
  await requirePageAccess('/admin/mis-email-routing');
  return <MisEmailRoutingPageClient />;
}
