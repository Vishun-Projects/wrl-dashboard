import { describe, expect, it } from 'vitest';
import {
  GMAIL_HTML_CLIP_BYTES,
  formatHtmlSize,
  gmailClipWarningMessage,
  isLikelyGmailClipped,
  measureHtmlUtf8Bytes,
} from '@/modules/mail-alerts/services/email-html-size';

describe('email-html-size', () => {
  it('measures UTF-8 bytes', () => {
    expect(measureHtmlUtf8Bytes('hello')).toBe(5);
    expect(measureHtmlUtf8Bytes('₹')).toBe(3);
  });

  it('detects Gmail clip threshold', () => {
    expect(isLikelyGmailClipped(GMAIL_HTML_CLIP_BYTES - 1)).toBe(false);
    expect(isLikelyGmailClipped(GMAIL_HTML_CLIP_BYTES + 1)).toBe(true);
  });

  it('formats warning messages', () => {
    expect(gmailClipWarningMessage(50 * 1024)).toBe('');
    expect(gmailClipWarningMessage(96 * 1024)).toContain('close to Gmail');
    expect(gmailClipWarningMessage(110 * 1024)).toContain(formatHtmlSize(110 * 1024));
  });
});
