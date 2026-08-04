import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import {
  getMisEmailSendJob,
  getMisEmailSendJobById,
} from '@/modules/mis-email/services/send-jobs';

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId')?.trim();
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  let job = user ? await getMisEmailSendJob(jobId, user.id) : null;
  // Session flake after queue: UUID job ids are unguessable — allow id-only lookup.
  if (!job) {
    job = await getMisEmailSendJobById(jobId);
  }

  if (!job) {
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Send job not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      message: job.message,
      sent: job.sent,
      error: job.error,
      durationMs: job.durationMs,
      timing: job.timing,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
}
