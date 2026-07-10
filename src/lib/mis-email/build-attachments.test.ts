import { describe, expect, it } from 'vitest';
import { resolveDigestAttachmentFilenames } from '@/lib/mis-email/build-attachments';

describe('resolveDigestAttachmentFilenames', () => {
  it('returns filenames without building workbooks', () => {
    const names = resolveDigestAttachmentFilenames({
      includeSummary: true,
      includeDetailed: true,
      includeKeyAccount: true,
      includeTraceableExport: true,
      includeOpenCallsExport: false,
    });
    expect(names).toHaveLength(4);
    expect(names[0]).toMatch(/Summary Dashboard/);
    expect(names[1]).toMatch(/Detailed MIS/);
    expect(names[2]).toMatch(/Key Account MIS/);
    expect(names[3]).toMatch(/Traceable/);
  });
});
