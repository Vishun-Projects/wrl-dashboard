import { redirect } from 'next/navigation';

/** Legacy path — VPS Cron lives under Mail & Alerts. */
export default function VpsCronPage() {
  redirect('/admin/mis-email-settings?tab=cron');
}
