'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { TableSkeleton } from '@/components/ui/DataTableLoading';
import {
  AdminStatPill,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';

type AuditEvent = {
  id: number;
  created_at: string;
  event_type: string;
  result: string;
  actor_email: string | null;
  actor_name?: string | null;
  action_label?: string | null;
  summary?: string | null;
  route: string | null;
  method: string | null;
  ip: string | null;
  status_code: number | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  metadata: Record<string, unknown> | null;
};

type Filters = {
  eventType: string;
  actorEmail: string;
  result: string;
  from: string;
  to: string;
};

const emptyFilters: Filters = {
  eventType: '',
  actorEmail: '',
  result: '',
  from: '',
  to: '',
};

function formatDurationMs(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = sec - min * 60;
  return `${min}m ${Math.round(rem)}s`;
}

function resultClass(result: string): string {
  switch (result) {
    case 'success':
    case 'completed':
      return 'text-emerald-700';
    case 'failure':
    case 'denied':
      return 'text-rose-700';
    case 'cancelled':
      return 'text-amber-700';
    case 'started':
      return 'text-sky-700';
    default:
      return 'text-slate-700';
  }
}

export default function SecurityAuditPageClient() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadEvents = useCallback(async (next: Filters) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: '200' });
      if (next.eventType.trim()) params.set('eventType', next.eventType.trim());
      if (next.actorEmail.trim()) params.set('actorEmail', next.actorEmail.trim());
      if (next.result.trim()) params.set('result', next.result.trim());
      if (next.from.trim()) params.set('from', next.from.trim());
      if (next.to.trim()) params.set('to', `${next.to.trim()}T23:59:59`);
      const res = await fetch(`/api/admin/security-audit?${params}`, { credentials: 'include' });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load activity log');
      }
      setEvents(Array.isArray(payload?.events) ? payload.events : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents(emptyFilters);
  }, [loadEvents]);

  return (
    <PageShell
      title="Activity Log"
      subtitle="Who did what, when — auth, admin, exports, imports, sync, mail"
      icon={<Activity size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      actions={
        <button
          type="button"
          onClick={() => void loadEvents(filters)}
          className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      }
      toolbar={
        <form
          className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-bg-canvas px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void loadEvents(filters);
          }}
        >
          <input
            className="min-w-[10rem] flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            placeholder="Action key (e.g. import.mis_client.upload)"
            value={filters.eventType}
            onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
          />
          <input
            className="min-w-[9rem] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            placeholder="Actor email"
            value={filters.actorEmail}
            onChange={(e) => setFilters((f) => ({ ...f, actorEmail: e.target.value }))}
          />
          <select
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={filters.result}
            onChange={(e) => setFilters((f) => ({ ...f, result: e.target.value }))}
          >
            <option value="">All results</option>
            <option value="success">success</option>
            <option value="completed">completed</option>
            <option value="started">started</option>
            <option value="cancelled">cancelled</option>
            <option value="failure">failure</option>
            <option value="denied">denied</option>
          </select>
          <input
            type="date"
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
          <input
            type="date"
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            Filter
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setFilters(emptyFilters);
              void loadEvents(emptyFilters);
            }}
          >
            Reset
          </button>
          <AdminStatPill label="Showing" value={loading ? '…' : events.length} />
        </form>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <AdminTableCard
          isEmpty={!loading && !error && events.length === 0}
          empty={
            <>
              <p className="text-sm font-medium text-slate-600">No activity found</p>
              <p className="ui-micro">Try adjusting filters or perform an action, then refresh.</p>
            </>
          }
        >
          {loading ? (
            <TableSkeleton columns={7} rows={10} />
          ) : (
            <AdminTable className="w-full min-w-[960px] border-collapse text-left text-xs">
              <AdminThead>
                <tr>
                  <AdminTh>When</AdminTh>
                  <AdminTh>Who</AdminTh>
                  <AdminTh>Action</AdminTh>
                  <AdminTh>Target</AdminTh>
                  <AdminTh>Result</AdminTh>
                  <AdminTh>Duration</AdminTh>
                  <AdminTh>IP</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {events.map((event) => {
                  const who =
                    [event.actor_name, event.actor_email].filter(Boolean).join(' · ') || '-';
                  const target =
                    event.target_label ||
                    (event.target_type
                      ? `${event.target_type}${event.target_id ? `:${event.target_id}` : ''}`
                      : '-');
                  const duration = formatDurationMs(event.metadata?.durationMs);
                  const open = expandedId === event.id;
                  return (
                    <Fragment key={event.id}>
                      <AdminTr
                        className="cursor-pointer align-top hover:bg-slate-50"
                        onClick={() => setExpandedId(open ? null : event.id)}
                      >
                        <AdminTd className="whitespace-nowrap text-slate-600">
                          {new Date(event.created_at).toLocaleString('en-IN')}
                        </AdminTd>
                        <AdminTd className="max-w-[12rem] truncate text-slate-700">
                          <span title={who}>{who}</span>
                        </AdminTd>
                        <AdminTd>
                          <div className="font-medium text-slate-800">
                            {event.action_label || event.event_type}
                          </div>
                          <div className="max-w-[22rem] truncate text-[10px] text-slate-400">
                            {event.summary || event.event_type}
                          </div>
                        </AdminTd>
                        <AdminTd className="max-w-[14rem] truncate text-slate-600">
                          <span title={target}>{target}</span>
                        </AdminTd>
                        <AdminTd className={`font-medium ${resultClass(event.result)}`}>
                          {event.result}
                        </AdminTd>
                        <AdminTd className="whitespace-nowrap tabular-nums text-slate-600">
                          {duration ?? '—'}
                        </AdminTd>
                        <AdminTd className="whitespace-nowrap text-slate-500">
                          {event.ip || '—'}
                        </AdminTd>
                      </AdminTr>
                      {open && (
                        <tr className="border-t border-slate-100 bg-slate-50/80">
                          <td className="px-4 py-3 text-[11px] text-slate-600" colSpan={7}>
                            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                              <span>
                                <span className="font-medium">Route:</span> {event.method}{' '}
                                {event.route}
                                {event.status_code != null ? ` · HTTP ${event.status_code}` : ''}
                              </span>
                              <span>
                                <span className="font-medium">Key:</span> {event.event_type}
                              </span>
                              {typeof event.metadata?.processDurationMs === 'number' && (
                                <span>
                                  <span className="font-medium">Process:</span>{' '}
                                  {formatDurationMs(event.metadata.processDurationMs)}
                                </span>
                              )}
                            </div>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-[10px] text-slate-700 custom-scrollbar">
                              {JSON.stringify(event.metadata ?? {}, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </AdminTable>
          )}
        </AdminTableCard>
      </div>
    </PageShell>
  );
}
