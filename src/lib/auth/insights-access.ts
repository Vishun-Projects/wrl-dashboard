const DEFAULT_ALLOWED_EMAILS = ['vishunvishwakarma90211@gmail.com'];

export const PERFORMANCE_INSIGHTS_PATH = '/admin/performance-insights';

function parseAllowedEmails(): string[] {
  const raw = process.env.INSIGHTS_ALLOWED_EMAILS?.trim();
  if (!raw) return DEFAULT_ALLOWED_EMAILS;
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function canAccessInsights(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return parseAllowedEmails().includes(normalized);
}

export function isPerformanceInsightsPath(path: string): boolean {
  return path === PERFORMANCE_INSIGHTS_PATH || path.startsWith(`${PERFORMANCE_INSIGHTS_PATH}/`);
}
