'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Pause, Play, RefreshCw, Timer, Users } from 'lucide-react';
import { feedback } from '@/lib/ui/feedback';
import {
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import {
  MAIL_ALERTS_CONTENT,
  MAIL_ALERTS_PANEL,
} from '@/modules/mail-alerts/components/mail-alerts-ui';

type CronJobRow = {
  id: string;
  label: string;
  schedule: string;
  script: string;
  paused: boolean;
};

type ScheduleRow = {
  id: string;
  name: string;
  email: string;
  misEmailEnabled: boolean;
  subscribed: boolean;
  sendTimeIst: string;
};

export default function MisEmailCronSchedulesPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [jobs, setJobs] = useState<CronJobRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cronRes, schedRes] = await Promise.all([
        axios.get('/api/admin/vps-cron', { withCredentials: true }),
        axios.get('/api/admin/mis-email-schedules', { withCredentials: true }),
      ]);
      setJobs((cronRes.data.jobs as CronJobRow[]) ?? []);
      setSchedules((schedRes.data.schedules as ScheduleRow[]) ?? []);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load VPS cron / schedules';
      feedback.actionFailed(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (job: CronJobRow) => {
    setBusyId(job.id);
    try {
      const res = await axios.patch(
        '/api/admin/vps-cron',
        { jobId: job.id, paused: !job.paused },
        { withCredentials: true }
      );
      setJobs((res.data.jobs as CronJobRow[]) ?? []);
      feedback.actionSuccess(job.paused ? `Resumed ${job.label}` : `Paused ${job.label}`);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to update cron job';
      feedback.actionFailed(message);
    } finally {
      setBusyId(null);
    }
  };

  const body = (
    <div className={embedded ? MAIL_ALERTS_CONTENT : 'space-y-4 p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="ui-help max-w-3xl text-slate-600">
          Pause stops VPS jobs even if crontab still fires. User schedules below are personal digests
          (that account only) — independent of HOD routing To/Cc.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <section className="space-y-2">
        <h2 className="ui-section-title flex items-center gap-1.5">
          <Timer size={14} className="text-slate-400" />
          VPS jobs
        </h2>
        <AdminTableCard>
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh>Job</AdminTh>
                <AdminTh>Schedule</AdminTh>
                <AdminTh>Status</AdminTh>
                <AdminTh className="text-right">Action</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-[12px] text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <AdminTr key={job.id}>
                    <AdminTd>
                      <p className="font-medium text-slate-900">{job.label}</p>
                      <p className="ui-help text-slate-500">{job.script}</p>
                    </AdminTd>
                    <AdminTd className="text-slate-600">{job.schedule}</AdminTd>
                    <AdminTd>
                      <span
                        className={
                          job.paused
                            ? 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800'
                            : 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800'
                        }
                      >
                        {job.paused ? 'Paused' : 'Active'}
                      </span>
                    </AdminTd>
                    <AdminTd className="text-right">
                      <button
                        type="button"
                        disabled={busyId === job.id}
                        onClick={() => void toggle(job)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {job.paused ? <Play size={13} /> : <Pause size={13} />}
                        {job.paused ? 'Resume' : 'Pause'}
                      </button>
                    </AdminTd>
                  </AdminTr>
                ))
              )}
            </tbody>
          </AdminTable>
        </AdminTableCard>
      </section>

      <section className="space-y-2">
        <h2 className="ui-section-title flex items-center gap-1.5">
          <Users size={14} className="text-slate-400" />
          User personal schedules
        </h2>
        <p className="ui-help text-slate-500">
          Personal send times from Profile → Email reports. “Digest enabled” must be Yes for the VPS
          cron to send; saving a scheduled digest on profile turns that on automatically.
        </p>
        <AdminTableCard>
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh>User</AdminTh>
                <AdminTh>Send time (IST)</AdminTh>
                <AdminTh>Scheduled</AdminTh>
                <AdminTh>Digest enabled</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-[12px] text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : schedules.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-[12px] text-slate-500">
                    No users with MIS email schedules yet.
                  </td>
                </tr>
              ) : (
                schedules.map((row) => (
                  <AdminTr key={row.id}>
                    <AdminTd>
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <p className="ui-help text-slate-500">{row.email}</p>
                    </AdminTd>
                    <AdminTd className="tabular-nums text-slate-800">{row.sendTimeIst}</AdminTd>
                    <AdminTd>
                      <span
                        className={
                          row.subscribed
                            ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600'
                        }
                      >
                        {row.subscribed ? 'On' : 'Off'}
                      </span>
                    </AdminTd>
                    <AdminTd>
                      <span
                        className={
                          row.misEmailEnabled
                            ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800'
                            : 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800'
                        }
                      >
                        {row.misEmailEnabled ? 'Yes' : 'No — cron skips'}
                      </span>
                    </AdminTd>
                  </AdminTr>
                ))
              )}
            </tbody>
          </AdminTable>
        </AdminTableCard>
      </section>
    </div>
  );

  if (embedded) {
    return <div className={MAIL_ALERTS_PANEL}>{body}</div>;
  }
  return body;
}
