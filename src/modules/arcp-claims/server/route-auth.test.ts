import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockCreateClient = vi.fn();
const mockResolveRequestUserId = vi.fn();
const mockLoadUserAuth = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock('@/lib/auth/server-user', () => ({
  resolveRequestUserId: (...args: unknown[]) => mockResolveRequestUserId(...args),
}));

vi.mock('@/lib/auth/load-user-auth', () => ({
  loadUserAuth: (...args: unknown[]) => mockLoadUserAuth(...args),
}));

vi.mock('@/lib/auth/report-security', () => ({
  isHodUser: () => false,
}));

import { authenticateArcpClaimsRequest } from '@/modules/arcp-claims/server/route-auth';

function makeRequest(url = 'http://localhost/api/report/arcp-claims'): NextRequest {
  return new NextRequest(url);
}

function responseBody(res: NextResponse): Promise<{ error?: string }> {
  return res.json() as Promise<{ error?: string }>;
}

describe('authenticateArcpClaimsRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({});
  });

  it('returns 401 Unauthorized when no session or bearer token', async () => {
    mockResolveRequestUserId.mockResolvedValue(null);

    const result = await authenticateArcpClaimsRequest(makeRequest());

    expect(result).toBeInstanceOf(NextResponse);
    const body = await responseBody(result as NextResponse);
    expect((result as NextResponse).status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body.error).not.toBe('No authorization header');
  });

  it('returns 403 when user lacks page_arcp_claims permission', async () => {
    mockResolveRequestUserId.mockResolvedValue('user-1');
    mockLoadUserAuth.mockResolvedValue({
      permissions: ['page_mis_reports'],
      profile: { office_ids: ['1'] },
    });

    const result = await authenticateArcpClaimsRequest(makeRequest());

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    const body = await responseBody(result as NextResponse);
    expect(body.error).toBe('Forbidden');
  });

  it('returns auth context when cookie session resolves a permitted user', async () => {
    mockResolveRequestUserId.mockResolvedValue('user-1');
    mockLoadUserAuth.mockResolvedValue({
      permissions: ['page_arcp_claims'],
      profile: { office_ids: ['10', '20'] },
    });

    const result = await authenticateArcpClaimsRequest(
      makeRequest('http://localhost/api/report/arcp-claims?startDate=2026-06-01&endDate=2026-06-25')
    );

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({
      userId: 'user-1',
      isHod: false,
      assignedOffices: ['10', '20'],
      opts: {
        startDate: '2026-06-01',
        endDate: '2026-06-25',
        isHod: false,
        assignedOffices: ['10', '20'],
      },
    });
    expect(mockResolveRequestUserId).toHaveBeenCalledOnce();
  });
});
