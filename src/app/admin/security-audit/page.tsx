import { requirePageAccess } from '@/lib/auth/require-page-access';
import { canViewSecurityAudit } from '@/lib/security/audit-access';
import SecurityAuditPageClient from '@/modules/activity-log/pages/ActivityLogPageClient';

export default async function SecurityAuditPage() {
  const user = await requirePageAccess('/admin/security-audit');
  if (!canViewSecurityAudit(user.permissions)) {
    return (
      <div className="space-y-2 p-6">
        <h1 className="text-xl font-semibold text-slate-900">Activity Log</h1>
        <p className="text-sm text-rose-600">
          Access denied for this account ({user.email || 'unknown email'}).
        </p>
        <p className="text-xs text-slate-500">
          This page is restricted to Super Admins.
        </p>
      </div>
    );
  }
  return <SecurityAuditPageClient />;
}
