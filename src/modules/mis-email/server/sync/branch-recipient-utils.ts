/** Shared helpers for branch-keyed email recipient tables (major repair, cancelled digest). */

export const BRANCH_RECIPIENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeBranchKey(branch: string): string {
  return branch.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}
