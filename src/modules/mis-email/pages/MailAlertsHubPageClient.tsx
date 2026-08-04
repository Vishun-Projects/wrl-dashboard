'use client';

import { useMemo, useState } from 'react';
import { Bell, Mail, Route, Settings2, Timer } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import MisEmailOrgSettingsPageClient from '@/modules/mis-email/pages/MisEmailOrgSettingsPageClient';
import MisEmailRoutingPageClient from '@/modules/mis-email/pages/MisEmailRoutingPageClient';
import MajorRepairAlertsPageClient from '@/modules/mis-email/pages/MajorRepairAlertsPageClient';
import MisEmailCronSchedulesPanel from '@/modules/mis-email/components/MisEmailCronSchedulesPanel';
import {
  MAIL_ALERTS_TABS,
  type MailAlertsTab,
} from '@/modules/mis-email/components/MailAlertsSubnav';
import { canManageVpsCron } from '@/lib/security/audit-access';

const TAB_ICONS = {
  org: Settings2,
  routing: Route,
  repair: Bell,
  cron: Timer,
} as const;

function TabBar({
  active,
  onSelect,
  tabs,
}: {
  active: MailAlertsTab;
  onSelect: (tab: MailAlertsTab) => void;
  tabs: ReadonlyArray<{ id: MailAlertsTab; label: string }>;
}) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Mail and alerts tabs">
      {tabs.map(({ id, label }) => {
        const Icon = TAB_ICONS[id];
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={selected}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ui-label transition-colors ${
              selected
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

export default function MailAlertsHubPageClient({
  initialTab = 'org',
  permissions = [],
}: {
  initialTab?: MailAlertsTab;
  permissions?: string[];
}) {
  const showCron = canManageVpsCron(permissions);
  const tabs = useMemo(
    () => MAIL_ALERTS_TABS.filter((t) => t.id !== 'cron' || showCron),
    [showCron]
  );
  const safeInitial = initialTab === 'cron' && !showCron ? 'org' : initialTab;

  const [tab, setTab] = useState<MailAlertsTab>(safeInitial);
  const [visited, setVisited] = useState<Record<MailAlertsTab, boolean>>({
    org: safeInitial === 'org',
    routing: safeInitial === 'routing',
    repair: safeInitial === 'repair',
    cron: safeInitial === 'cron',
  });

  const selectTab = (next: MailAlertsTab) => {
    if (next === 'cron' && !showCron) return;
    setVisited((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'org') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };

  const panelClass = (id: MailAlertsTab) =>
    tab === id ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden';

  return (
    <PageShell
      title="Mail & Alerts"
      subtitle="Org defaults, routing rules, major-repair recipients, and (Super Admin) VPS cron — saving never sends mail."
      icon={<Mail size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      toolbar={
        <div className="register-filter-bar">
          <TabBar active={tab} onSelect={selectTab} tabs={tabs} />
        </div>
      }
    >
      {visited.org ? (
        <div className={panelClass('org')}>
          <MisEmailOrgSettingsPageClient embedded />
        </div>
      ) : null}
      {visited.routing ? (
        <div className={panelClass('routing')}>
          <MisEmailRoutingPageClient embedded />
        </div>
      ) : null}
      {visited.repair ? (
        <div className={panelClass('repair')}>
          <MajorRepairAlertsPageClient embedded />
        </div>
      ) : null}
      {showCron && visited.cron ? (
        <div className={panelClass('cron')}>
          <MisEmailCronSchedulesPanel embedded />
        </div>
      ) : null}
    </PageShell>
  );
}
