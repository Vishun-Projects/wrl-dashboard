import { z } from 'zod';

export const flagPostSchema = z.object({
  call_id: z.union([z.string(), z.number()]).transform(String),
  office_id: z.union([z.string(), z.number()]).transform(String),
  flag_type: z.string().trim().min(1).max(64),
  vtrnno: z.string().trim().max(128).optional().nullable(),
});

/** Accept camelCase + snake_case keys from older clients. */
export const commentPostSchema = z.object({
  callId: z.union([z.string(), z.number()]).transform(String).optional(),
  call_id: z.union([z.string(), z.number()]).transform(String).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
  text: z.string().trim().min(1).max(8000).optional(),
  office_id: z.union([z.string(), z.number()]).transform(String),
}).refine((data) => !!(data.content || data.text), {
  message: 'content is required',
  path: ['content'],
}).refine((data) => !!(data.callId || data.call_id), {
  message: 'callId is required',
  path: ['callId'],
});

export const appThemeSchema = z.enum(['white', 'cream', 'dark']);

export const profilePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  theme: appThemeSchema.optional(),
  avatar_url: z
    .string()
    .url()
    .max(2048)
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'https:' || parsed.protocol === 'http:';
        } catch {
          return false;
        }
      },
      { message: 'avatar_url must be a valid http(s) URL' }
    )
    .optional(),
});

const ALLOWED_AVATAR_HOSTS = [
  'api.wrl-fsm.cloud',
  'supabase.co',
  'supabase.in',
];

export function isAllowedAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return ALLOWED_AVATAR_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}
