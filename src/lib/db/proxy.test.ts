import { describe, expect, it } from 'vitest';
import { isCrmOutOfMemoryError, isCrmSqlTimeoutError } from './proxy';
import { isCrmHttpOverloadStatus } from './crm-http-health';

describe('isCrmOutOfMemoryError', () => {
  it('detects flagged CRM OOM errors', () => {
    const err = Object.assign(new Error('boom'), { crmOutOfMemory: true });
    expect(isCrmOutOfMemoryError(err)).toBe(true);
  });

  it('detects OutOfMemoryException in message', () => {
    expect(isCrmOutOfMemoryError(new Error('System.OutOfMemoryException'))).toBe(true);
  });
});

describe('isCrmSqlTimeoutError', () => {
  it('detects axios timeout messages', () => {
    expect(isCrmSqlTimeoutError(new Error('timeout of 120000ms exceeded'))).toBe(true);
  });

  it('detects SQL timeout text', () => {
    expect(isCrmSqlTimeoutError(new Error('Timeout expired. The timeout period elapsed'))).toBe(
      true
    );
  });
});

describe('CRM HTTP overload statuses (405 storm path)', () => {
  it('flags Method Not Allowed and gateway overload codes', () => {
    expect(isCrmHttpOverloadStatus(405)).toBe(true);
    expect(isCrmHttpOverloadStatus(503)).toBe(true);
  });
});
