import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMisEmailSendJob,
  getMisEmailSendJob,
  resetMisEmailSendJobsForTests,
  updateMisEmailSendJob,
} from '@/modules/mail-alerts/services/send-jobs';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('information_schema.tables')) {
        return [{ exists: false }];
      }
      throw Object.assign(new Error('relation "mis_email_send_jobs" does not exist'), { code: '42P01' });
    }),
  },
}));

describe('mis-email send jobs', () => {
  beforeEach(() => {
    resetMisEmailSendJobsForTests();
    vi.clearAllMocks();
  });

  it('creates and updates a job for a user in memory fallback', async () => {
    const job = await createMisEmailSendJob('user-1');
    expect(job.status).toBe('queued');

    await updateMisEmailSendJob(job.id, { status: 'running', message: 'Working…' });
    const loaded = await getMisEmailSendJob(job.id, 'user-1');
    expect(loaded?.status).toBe('running');
    expect(loaded?.message).toBe('Working…');
  });

  it('reuses an active job for the same user', async () => {
    const first = await createMisEmailSendJob('user-2');
    const second = await createMisEmailSendJob('user-2');
    expect(second.id).toBe(first.id);
  });

  it('does not expose jobs to other users', async () => {
    const job = await createMisEmailSendJob('user-3');
    expect(await getMisEmailSendJob(job.id, 'other-user')).toBeNull();
  });
});
