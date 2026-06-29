const DEFAULT_ALLOWLIST = ['vishunvishwakarma90211@gmail.com'];

function buildAllowlist(): Set<string> {
  const env = process.env.MIS_CLIENT_UPLOAD_ALLOWLIST?.trim();
  const emails = env
    ? env.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWLIST.map((e) => e.toLowerCase());
  return new Set(emails);
}

export function canUploadClientMis(email: string | null | undefined): boolean {
  if (!email) return false;
  return buildAllowlist().has(email.toLowerCase().trim());
}
