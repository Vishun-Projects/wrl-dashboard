import { requirePageAccess } from '@/lib/auth/require-page-access';
import AttendancePageClient from '@/modules/attendance/pages/AttendancePageClient';

export default async function AttendancePage() {
  await requirePageAccess('/admin/attendance');
  return <AttendancePageClient />;
}
