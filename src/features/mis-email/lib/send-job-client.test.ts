import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMisEmailSendFinished,
  finishMisEmailSendJobClient,
  getMisEmailSendJobsSnapshot,
  trackMisEmailSendJob,
  updateMisEmailSendJobClient,
} from '@/features/mis-email/lib/send-job-client';
import { feedback } from '@/lib/ui/feedback';

vi.mock('@/lib/ui/feedback', () => ({
  feedback: {
    loading: vi.fn(() => 'toast-1'),
    loadingUpdate: vi.fn(),
    loadingSuccess: vi.fn(),
    loadingFailed: vi.fn(),
  },
}));

describe('mis-email send job client', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearMisEmailSendFinished();
    while (getMisEmailSendJobsSnapshot().activeJobs.length > 0) {
      const job = getMisEmailSendJobsSnapshot().activeJobs[0];
      finishMisEmailSendJobClient(job.jobId, { ok: true, message: 'done' });
    }
    vi.clearAllMocks();
  });

  it('tracks a job with a loading toast', () => {
    trackMisEmailSendJob('job-1', 'Queued');
    expect(feedback.loading).toHaveBeenCalledWith('Queued');
    expect(getMisEmailSendJobsSnapshot().activeJobs).toHaveLength(1);
  });

  it('updates loading toast message while running', () => {
    trackMisEmailSendJob('job-1', 'Queued');
    updateMisEmailSendJobClient('job-1', {
      status: 'running',
      message: 'Building reports…',
    });
    expect(feedback.loadingUpdate).toHaveBeenCalledWith('toast-1', 'Building reports…');
  });

  it('finishes with success toast and clears active job', () => {
    trackMisEmailSendJob('job-1', 'Queued');
    finishMisEmailSendJobClient('job-1', { ok: true, message: 'Sent to a@b.com' });
    expect(feedback.loadingSuccess).toHaveBeenCalledWith('toast-1', 'Sent to a@b.com');
    expect(getMisEmailSendJobsSnapshot().activeJobs).toHaveLength(0);
    expect(getMisEmailSendJobsSnapshot().lastFinished?.ok).toBe(true);
  });
});
