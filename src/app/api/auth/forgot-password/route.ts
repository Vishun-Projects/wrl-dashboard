import { NextResponse } from 'next/server';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import { validateForgotPasswordEmail } from '@/lib/auth/forgot-password-core';
import {
  forgotPasswordStatusMessage,
  lookupForgotPasswordAccount,
} from '@/lib/auth/forgot-password-lookup';
import { sendRecoveryEmailForAccount } from '@/lib/auth/send-recovery-email';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const validated = validateForgotPasswordEmail(body.email);

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const account = await lookupForgotPasswordAccount(validated.email);

    if (!account.inAuth) {
      return NextResponse.json(
        {
          ok: false,
          found: false,
          inAuth: account.inAuth,
          inAppUsers: account.inAppUsers,
          message: forgotPasswordStatusMessage(account),
        },
        { status: 404 }
      );
    }

    if (isDevAuthBypass()) {
      return NextResponse.json({
        ok: false,
        found: true,
        inAuth: true,
        inAppUsers: account.inAppUsers,
        message:
          'Account exists, but password reset email is not sent from localhost. Use https://wrl-dashboard.vercel.app/forgot-password',
      });
    }

    const sent = await sendRecoveryEmailForAccount({
      email: validated.email,
      recipientName: account.appUserName,
    });

    if (!sent.ok) {
      console.error('[forgot-password] send failed:', sent.error);
      return NextResponse.json(
        {
          ok: false,
          found: true,
          inAuth: true,
          inAppUsers: account.inAppUsers,
          message: `Account found, but the reset email could not be sent: ${sent.error}. Contact IT if this persists.`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      found: true,
      inAuth: true,
      inAppUsers: account.inAppUsers,
      message: `Reset link sent to ${validated.email}. Check inbox and spam (sender: reports@wrl-fsm.cloud).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Password reset request failed';
    console.error('[forgot-password]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
