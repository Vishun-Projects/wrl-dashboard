import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { getMisEmailSendJob } from '@/lib/mis-email/send-jobs';

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get('jobId')?.trim();
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const job = await getMisEmailSendJob(jobId, user.id);
  if (!job) {
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
