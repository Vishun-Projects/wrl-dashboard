'use client';

import { useState } from 'react';
import { Bell, Mail, Route, Settings2 } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import MisEmailOrgSettingsPageClient from '@/features/mis-email/ui/MisEmailOrgSettingsPageClient';
import MisEmailRoutingPageClient from '@/features/mis-email/ui/MisEmailRoutingPageClient';
import MajorRepairAlertsPageClient from '@/features/major-repair-alerts/ui/MajorRepairAlertsPageClient';
import {
  MAIL_ALERTS_TABS,
  type MailAlertsTab,
} from '@/features/mis-email/ui/MailAlertsSubnav';

const TAB_ICONS = {
  org: Settings2,
  routing: Route,
  repair: Bell,
} as const;

function TabBar({
  active,
  onSelect,
}: {
  active: MailAlertsTab;
  onSelect: (tab: MailAlertsTab) => void;
}) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Mail and alerts tabs">
      {MAIL_ALERTS_TABS.map(({ id, label }) => {
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
}: {
  initialTab?: MailAlertsTab;
}) {
  const [tab, setTab] = useState<MailAlertsTab>(initialTab);
  const [visited, setVisited] = useState<Record<MailAlertsTab, boolean>>({
    org: initialTab === 'org',
    routing: initialTab === 'routing',
    repair: initialTab === 'repair',
  });

  const selectTab = (next: MailAlertsTab) => {
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
      subtitle="Org defaults, routing rules, and major-repair recipients — saving never sends mail."
      icon={<Mail size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      toolbar={
        <div className="register-filter-bar">
          <TabBar active={tab} onSelect={selectTab} />
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
    </PageShell>
  );
}
