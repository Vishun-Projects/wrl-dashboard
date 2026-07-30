import { NextResponse } from 'next/server';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  validateForgotPasswordEmail,
} from '@/lib/auth/forgot-password-core';
import { lookupForgotPasswordAccount } from '@/lib/auth/forgot-password-lookup';
import { sendRecoveryEmailForAccount } from '@/lib/auth/send-recovery-email';
import { logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

function genericOk() {
  return NextResponse.json({ ok: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
}

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

    const actorEmail = validated.email;
    const account = await lookupForgotPasswordAccount(validated.email);

    if (!account.inAuth) {
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.request',
        result: 'failure',
        actorEmail,
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 200,
        metadata: {
          reason: 'account_not_found',
          inAuth: account.inAuth,
          inAppUsers: account.inAppUsers,
        },
      });
      return genericOk();
    }

    if (isDevAuthBypass()) {
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.request',
        result: 'failure',
        actorEmail,
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 200,
        metadata: { reason: 'dev_auth_bypass' },
      });
      return genericOk();
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
        actorEmail,
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 200,
        metadata: { reason: 'send_failed', message: sent.error },
      });
      return genericOk();
    }

    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.request',
      result: 'success',
      actorEmail,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      metadata: { reason: 'sent' },
    });
    return genericOk();
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
      statusCode: 200,
      metadata: { reason: 'exception', message },
    });
    return genericOk();
  }
}
