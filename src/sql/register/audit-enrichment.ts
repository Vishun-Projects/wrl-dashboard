import { prisma } from '@/lib/db/prisma';

export type AuditEnrichmentMode = 'list' | 'detail';

type FlagRow = { call_id: string; flag_type: string };
type CommentCountRow = { call_id: string; cnt: number };
type CommentDetailRow = {
  call_id: string;
  author_name: string | null;
  comment: string | null;
  content: string | null;
  created_at: Date;
  author_id: string | null;
};

function rowCallId(row: Record<string, unknown>): string {
  return String(row.id ?? row.ncode ?? '');
}

export async function mergeAuditEnrichment<T extends Record<string, unknown>>(
  rows: T[],
  mode: AuditEnrichmentMode = 'list'
): Promise<T[]> {
  if (!rows.length) return rows;

  const callIds = rows.map(rowCallId).filter(Boolean);
  if (!callIds.length) return rows;

  if (mode === 'list') {
    const [flags, commentCounts] = await Promise.all([
      prisma.$queryRawUnsafe<FlagRow[]>(
        `SELECT call_id, flag_type FROM call_flags WHERE call_id = ANY($1::text[])`,
        callIds
      ),
      prisma.$queryRawUnsafe<CommentCountRow[]>(
        `SELECT call_id, count(*)::int AS cnt
         FROM call_comments
         WHERE call_id = ANY($1::text[])
         GROUP BY call_id`,
        callIds
      ),
    ]);

    const flagByCallId = new Map(flags.map((f) => [String(f.call_id), String(f.flag_type)]));
    const countByCallId = new Map(commentCounts.map((c) => [String(c.call_id), c.cnt]));

    return rows.map((row) => {
      const id = rowCallId(row);
      return {
        ...row,
        audit_flag: flagByCallId.get(id) ?? null,
        comment_count: countByCallId.get(id) ?? 0,
        ...(row.nofficeid != null ? { office_id: String(row.nofficeid) } : {}),
      };
    });
  }

  const [flags, comments] = await Promise.all([
    prisma.$queryRawUnsafe<FlagRow[]>(
      `SELECT call_id, flag_type FROM call_flags WHERE call_id = ANY($1::text[])`,
      callIds
    ),
    prisma.$queryRawUnsafe<CommentDetailRow[]>(
      `SELECT call_id, author_name, comment, content, created_at, author_id
       FROM call_comments
       WHERE call_id = ANY($1::text[])
       ORDER BY created_at DESC`,
      callIds
    ),
  ]);

  const authorIds = Array.from(
    new Set(comments.map((cm) => cm.author_id).filter((id): id is string => !!id))
  );
  const authors =
    authorIds.length > 0
      ? await prisma.$queryRawUnsafe<Array<{ id: string; avatar_url: string | null }>>(
          `SELECT id, avatar_url FROM app_users WHERE id = ANY($1::uuid[])`,
          authorIds
        )
      : [];
  const avatarByAuthor = new Map(authors.map((a) => [a.id, a.avatar_url]));

  const flagByCallId = new Map(flags.map((f) => [String(f.call_id), String(f.flag_type)]));

  return rows.map((row) => {
    const id = rowCallId(row);
    const callComments = comments
      .filter((cm) => cm.call_id === id)
      .map((cm) => ({
        author_name: cm.author_name,
        comment: cm.comment || cm.content,
        created_at: cm.created_at,
        author_avatar_url: cm.author_id ? avatarByAuthor.get(cm.author_id) ?? null : null,
      }));

    return {
      ...row,
      audit_flag: flagByCallId.get(id) ?? null,
      comment_count: callComments.length,
      comments: callComments,
      ...(row.nofficeid != null ? { office_id: String(row.nofficeid) } : {}),
    };
  });
}
