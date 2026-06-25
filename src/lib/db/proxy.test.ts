import { describe, expect, it } from 'vitest';
import { isCrmOutOfMemoryError, isCrmSqlTimeoutError } from './proxy';

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
