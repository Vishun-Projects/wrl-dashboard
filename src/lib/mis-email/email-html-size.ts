/** Gmail hides HTML past ~102 KB and shows "[Message clipped] View entire message". */
export const GMAIL_HTML_CLIP_BYTES = 102 * 1024;

/** Leave headroom for wrapper markup and minor encoding variance. */
export const GMAIL_SAFE_HTML_BYTES = 95 * 1024;

export function measureHtmlUtf8Bytes(html: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(html).length;
  }
  return Buffer.byteLength(html, 'utf8');
}

export function formatHtmlSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function isLikelyGmailClipped(htmlBytes: number): boolean {
  return htmlBytes > GMAIL_HTML_CLIP_BYTES;
}

export function isNearGmailClipLimit(htmlBytes: number): boolean {
  return htmlBytes > GMAIL_SAFE_HTML_BYTES;
}

export function gmailClipWarningMessage(htmlBytes: number): string {
  if (!isNearGmailClipLimit(htmlBytes)) return '';
  if (isLikelyGmailClipped(htmlBytes)) {
    return `Email HTML is ${formatHtmlSize(htmlBytes)} — Gmail clips messages over ~102 KB. Key-account rows were shortened in the body; use the attached Excel for the full list.`;
  }
  return `Email HTML is ${formatHtmlSize(htmlBytes)} — close to Gmail's ~102 KB clip limit. Consider filtering key accounts in the body.`;
}
