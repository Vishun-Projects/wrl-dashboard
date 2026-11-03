import SapVendorMasterPageClient from '@/modules/mb51-aging/pages/SapVendorMasterPageClient';
import { requirePageAccess } from '@/lib/auth/require-page-access';

export default async function AdminVendorMasterPage() {
  await requirePageAccess('/admin/vendor-master');
  return <SapVendorMasterPageClient />;
}
