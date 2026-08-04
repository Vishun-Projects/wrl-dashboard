/**
 * Parse Outlook-style recipient paste into unique lowercase emails.
 * Accepts: `'Name' <a@b.com>; Name <c@d.com>; e@f.com`
 */
export function parseOutlookEmailList(raw: string): string[] {
  if (!raw?.trim()) return [];

  const emails: string[] = [];
  const seen = new Set<string>();

  const push = (value: string) => {
    const email = value.trim().toLowerCase().replace(/^['"]+|['"]+$/g, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) return;
    seen.add(email);
    emails.push(email);
  };

  // Angle-bracket addresses first.
  const angleRe = /<([^<>@\s]+@[^<>@\s]+)>/gi;
  let match: RegExpExecArray | null;
  while ((match = angleRe.exec(raw)) !== null) {
    push(match[1]);
  }

  // Bare emails in remaining text (quoted or unquoted).
  const withoutAngles = raw.replace(/<[^>]*>/g, ' ');
  const bareRe = /[^\s<>;,]+@[^\s<>;,]+/g;
  while ((match = bareRe.exec(withoutAngles)) !== null) {
    push(match[0]);
  }

  return emails;
}

export function normalizeEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const email = item.trim().toLowerCase();
    if (!email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }
  return result;
}
