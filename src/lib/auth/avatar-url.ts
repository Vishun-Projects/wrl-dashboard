const PROFILES_BUCKET = 'profiles';
const AVATAR_PATH_RE = /^avatars\/[a-zA-Z0-9._-]+$/;

/** Storage object path under the `profiles` bucket (e.g. avatars/uuid.jpg). */
export function isValidAvatarStoragePath(path: string): boolean {
  return AVATAR_PATH_RE.test(path.trim());
}

/** True when path was built for this user (`avatars/<userId>-…`). */
export function isOwnAvatarStoragePath(path: string, userId: string): boolean {
  const trimmed = path.trim();
  if (!isValidAvatarStoragePath(trimmed) || !userId) return false;
  return trimmed.startsWith(`avatars/${userId}-`);
}

export function extractAvatarStoragePath(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath?.trim()) return null;
  const raw = urlOrPath.trim();
  if (isValidAvatarStoragePath(raw)) return raw;

  try {
    const parsed = new URL(raw, 'https://placeholder.local');
    const marker = `/storage/v1/object/public/${PROFILES_BUCKET}/`;
    const idx = parsed.pathname.indexOf(marker);
    if (idx >= 0) {
      const path = decodeURIComponent(parsed.pathname.slice(idx + marker.length));
      return isValidAvatarStoragePath(path) ? path : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Same-origin proxy — avoids browser TLS errors to self-hosted Supabase storage. */
export function avatarProxyUrl(storagePath: string): string {
  return `/api/profile/avatar?path=${encodeURIComponent(storagePath)}`;
}

/** Use in `<img src>` / Next Image — rewrites VPS storage URLs to the app proxy. */
export function resolveAvatarDisplayUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const path = extractAvatarStoragePath(url);
  if (path) return avatarProxyUrl(path);
  return url;
}

export function buildAvatarStoragePath(userId: string, ext: string): string {
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `avatars/${userId}-${Math.random().toString().slice(2)}.${safeExt}`;
}
