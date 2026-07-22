import { describe, expect, it } from 'vitest';
import { avatarProxyUrl, extractAvatarStoragePath, isOwnAvatarStoragePath, resolveAvatarDisplayUrl } from './avatar-url';

describe('avatar-url', () => {
  it('extracts storage path from VPS public URL', () => {
    const path = extractAvatarStoragePath(
      'https://api.wrl-fsm.cloud/storage/v1/object/public/profiles/avatars/user-1.jpg'
    );
    expect(path).toBe('avatars/user-1.jpg');
  });

  it('builds same-origin proxy URL for display', () => {
    expect(avatarProxyUrl('avatars/user-1.jpg')).toBe('/api/profile/avatar?path=avatars%2Fuser-1.jpg');
    expect(
      resolveAvatarDisplayUrl(
        'https://api.wrl-fsm.cloud/storage/v1/object/public/profiles/avatars/user-1.jpg'
      )
    ).toBe('/api/profile/avatar?path=avatars%2Fuser-1.jpg');
  });

  it('isOwnAvatarStoragePath matches userId prefix', () => {
    expect(isOwnAvatarStoragePath('avatars/abc-123.jpg', 'abc')).toBe(true);
    expect(isOwnAvatarStoragePath('avatars/other-123.jpg', 'abc')).toBe(false);
  });
});
