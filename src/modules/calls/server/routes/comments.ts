import { NextResponse } from 'next/server';

import { withAppClient } from '@/lib/read-model/db';
import { commentPostSchema } from '@/lib/api/schemas/mutations';
import { clearPortalAuditServerCache } from '@/modules/mis/server';

import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAccessOffice, seesAllOffices } from '@/sql/trhcalls/office-security';
import { isHodUser } from '@/lib/auth/report-security';
import { logAction } from '@/lib/security/audit';
import { jsonSafeError } from '@/lib/api/safe-error';
import { assertSameOriginMutation } from '@/lib/api/same-origin';

type CommentRow = {
  id: string;
  call_id: string;
  office_id: string;
  comment: string | null;
  content: string | null;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = await requireRbac(request as import('next/server').NextRequest, {
    pageId: 'mis_reports',
    tabId: 'register',
  });
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const callId = searchParams.get('callId');

    if (!callId) {
      return NextResponse.json({ error: 'callId is required' }, { status: 400 });
    }

    const userAuth = await loadUserAuth(auth.userId);
    const profile = userAuth?.profile;
    const permissions = userAuth?.permissions ?? [];
    const isHod = isHodUser(profile, permissions);
    const assignedOffices = profile?.office_ids || [];
    const seeAll = seesAllOffices(isHod, assignedOffices);

    const comments = await withAppClient(async (client) => {
      if (seeAll) {
        const res = await client.query<CommentRow>(
          `SELECT id, call_id, office_id, comment, content, author_id, author_name, created_at
           FROM public.call_comments
           WHERE call_id = $1
           ORDER BY created_at DESC`,
          [callId]
        );
        return res.rows;
      }

      const res = await client.query<CommentRow>(
        `SELECT id, call_id, office_id, comment, content, author_id, author_name, created_at
         FROM public.call_comments
         WHERE call_id = $1 AND office_id = ANY($2::text[])
         ORDER BY created_at DESC`,
        [callId, assignedOffices.map(String)]
      );
      return res.rows;
    });

    const authorIds = Array.from(new Set(comments.map((cm) => cm.author_id).filter(Boolean))) as string[];
    let authors: { id: string; avatar_url: string | null }[] = [];
    if (authorIds.length > 0) {
      authors = await withAppClient(async (client) => {
        const res = await client.query<{ id: string; avatar_url: string | null }>(
          `SELECT id, avatar_url FROM public.app_users WHERE id = ANY($1::uuid[])`,
          [authorIds]
        );
        return res.rows;
      });
    }

    const commentsWithAvatars = comments.map((cm) => {
      const author = authors.find((a) => a.id === cm.author_id);
      return {
        ...cm,
        author_avatar_url: author?.avatar_url || null,
      };
    });

    return NextResponse.json(commentsWithAvatars);
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load comments');
  }
}

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const auth = await requireRbac(request as import('next/server').NextRequest, {
    pageId: 'mis_reports',
    tabId: 'register',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const parsed = commentPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      );
    }

    const callId = parsed.data.callId ?? parsed.data.call_id!;
    const content = parsed.data.content ?? parsed.data.text!;
    const office_id = parsed.data.office_id;

    const userAuth = await loadUserAuth(auth.userId);
    const profile = userAuth?.profile;
    const permissions = userAuth?.permissions ?? [];
    const isHod = isHodUser(profile, permissions);
    const assignedOffices = profile?.office_ids || [];

    if (!canAccessOffice(isHod, assignedOffices, office_id)) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to comment for this office' },
        { status: 403 }
      );
    }

    const comment = await withAppClient(async (client) => {
      const res = await client.query<CommentRow>(
        `INSERT INTO public.call_comments
           (call_id, office_id, comment, author_name, author_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, call_id, office_id, comment, author_id, author_name, created_at`,
        [String(callId), String(office_id), content, profile?.name || 'User', auth.userId]
      );
      return res.rows[0];
    });

    clearPortalAuditServerCache();

    await logAction({
      request,
      action: 'register.comment.create',
      actor: {
        userId: auth.userId,
        email: profile?.email ?? null,
        name: profile?.name ?? null,
      },
      result: 'success',
      statusCode: 200,
      target: { type: 'call', id: String(callId), label: String(callId) },
      summary: 'Added call comment',
      metadata: { office_id: String(office_id), commentId: comment?.id ?? null },
    });

    return NextResponse.json(comment);
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to save comment');
  }
}
