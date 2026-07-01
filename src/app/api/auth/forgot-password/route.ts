import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import { resolveAppOrigin } from '@/lib/auth/site-url';
import {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  validateForgotPasswordEmail,
} from '@/lib/auth/forgot-password-core';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const validated = validateForgotPasswordEmail(body.email);

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    if (!isDevAuthBypass()) {
      const supabase = await createClient();
      const redirectTo = `${resolveAppOrigin()}/reset-password`;
      await supabase.auth.resetPasswordForEmail(validated.email, { redirectTo });
    }

    return NextResponse.json({ ok: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  } catch (err: unknown) {
    console.error('[forgot-password]', err);
    return NextResponse.json({ ok: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  }
}
