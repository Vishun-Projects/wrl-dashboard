import { requirePageAccess } from '@/lib/auth/require-page-access';
import MisEmailRoutingPageClient from './mis-email-routing-page-client';

export default async function MisEmailRoutingPage() {
  await requirePageAccess('/admin/mis-email-routing');
  return <MisEmailRoutingPageClient />;
}
