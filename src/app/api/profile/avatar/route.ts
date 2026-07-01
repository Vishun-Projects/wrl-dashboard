import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import {
  avatarProxyUrl,
  buildAvatarStoragePath,
  isValidAvatarStoragePath,
} from '@/lib/auth/avatar-url';
import { supabaseAdmin } from '@/lib/supabase/admin';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const path = String(searchParams.get('path') ?? '').trim();
  if (!isValidAvatarStoragePath(path)) {
    return NextResponse.json({ error: 'Invalid avatar path' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.storage.from('profiles').download(path);
  if (error || !data) {
    return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  const ext = path.split('.').pop()?.toLowerCase();
  const contentType =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : 'image/jpeg';

  return new NextResponse(bytes, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Please upload a JPEG, PNG, WebP, or GIF image.' },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 2 MB or smaller.' }, { status: 400 });
    }

    const ext = file.name.split('.').pop() || 'jpg';
    const storagePath = buildAvatarStoragePath(user.id, ext);
    const body = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from('profiles')
      .upload(storagePath, body, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from('profiles').getPublicUrl(storagePath);

    await prisma.$queryRawUnsafe(
      `UPDATE public.app_users SET avatar_url = $1 WHERE id = $2`,
      publicUrl,
      user.id
    );

    return NextResponse.json({
      avatar_url: publicUrl,
      display_url: avatarProxyUrl(storagePath),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    console.error('Profile avatar upload error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
