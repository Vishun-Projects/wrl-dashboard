import { requirePageAccess } from '@/lib/auth/require-page-access';
import AttendancePageClient from './attendance-page-client';

export default async function AttendancePage() {
  await requirePageAccess('/admin/attendance');
  return <AttendancePageClient />;
}
