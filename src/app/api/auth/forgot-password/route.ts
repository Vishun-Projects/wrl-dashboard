import { NextResponse } from 'next/server';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import { validateForgotPasswordEmail } from '@/lib/auth/forgot-password-core';
import {
  forgotPasswordStatusMessage,
  lookupForgotPasswordAccount,
} from '@/lib/auth/forgot-password-lookup';
import { sendRecoveryEmailForAccount } from '@/lib/auth/send-recovery-email';
import { logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

export async function POST(request: Request) {
  const audit = requestAuditContext(request);
  try {
    const body = (await request.json()) as { email?: string };
    const validated = validateForgotPasswordEmail(body.email);

    if (!validated.ok) {
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.request',
        result: 'failure',
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 400,
        metadata: { reason: 'invalid_email', email: body.email ?? null },
      });
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const account = await lookupForgotPasswordAccount(validated.email);

    if (!account.inAuth) {
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.request',
        result: 'failure',
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 404,
        metadata: { reason: 'account_not_found', email: validated.email },
      });
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
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.request',
        result: 'failure',
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 503,
        metadata: { reason: 'dev_auth_bypass', email: validated.email },
      });
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
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.request',
        result: 'failure',
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 502,
        metadata: { reason: 'send_failed', email: validated.email, message: sent.error },
      });
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

    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.request',
      result: 'success',
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      metadata: { email: validated.email },
    });
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
    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.request',
      result: 'failure',
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { reason: 'exception', message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
