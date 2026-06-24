import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import type { ZodSchema } from 'zod';
import {
  requireRbac,
  resolveBearerRbac,
  type BearerAuthResult,
} from '@/lib/auth/resolve-bearer-security';
import type { RbacApiSpec } from '@/lib/auth/rbac-catalog';

export type ReportApiOptions = {
  rbac: RbacApiSpec;
  method?: string;
};

export async function requireReportApi(
  req: NextRequest,
  opts: ReportApiOptions
): Promise<BearerAuthResult> {
  if (opts?.method && req.method !== opts.method) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Method not allowed' }, { status: 405 }),
    };
  }

  return requireRbac(req, opts.rbac);
}

/** Mutations must include Authorization: Bearer (no cookie-only CSRF surface). */
export async function requireBearerUser(
  req: NextRequest,
  opts: { rbac: RbacApiSpec }
): Promise<BearerAuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Bearer token required for this operation' },
        { status: 401 }
      ),
    };
  }
  return resolveBearerRbac(authHeader, opts.rbac);
}

export function parseQuery<T>(schema: ZodSchema<T>, searchParams: URLSearchParams) {
  const raw = Object.fromEntries(searchParams.entries());
  return schema.safeParse(raw);
}

export async function parseBody<T>(schema: ZodSchema<T>, req: NextRequest) {
  const json = await req.json().catch(() => null);
  return schema.safeParse(json);
}
