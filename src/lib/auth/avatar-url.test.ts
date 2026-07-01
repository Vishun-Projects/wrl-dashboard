import { describe, expect, it } from 'vitest';
import { avatarProxyUrl, extractAvatarStoragePath, resolveAvatarDisplayUrl } from './avatar-url';

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
});
