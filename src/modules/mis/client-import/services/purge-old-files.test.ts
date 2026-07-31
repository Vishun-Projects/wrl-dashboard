import { describe, expect, it } from 'vitest';
import {
  IMPORT_FILE_UNAVAILABLE_LABEL,
  IMPORT_FILE_RETENTION_DAYS,
  canManageImportFile,
  importFileRetentionTooltip,
  isImportFilePastRetention,
} from './file-retention';
import {
  DEFAULT_IMPORT_FILE_RETENTION_DAYS,
  resolveImportFileRetentionDays,
} from './purge-old-files';

describe('resolveImportFileRetentionDays', () => {
  it('defaults to one week', () => {
    expect(resolveImportFileRetentionDays({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_IMPORT_FILE_RETENTION_DAYS
    );
    expect(DEFAULT_IMPORT_FILE_RETENTION_DAYS).toBe(IMPORT_FILE_RETENTION_DAYS);
    expect(IMPORT_FILE_RETENTION_DAYS).toBe(7);
  });

  it('reads positive env override', () => {
    expect(
      resolveImportFileRetentionDays({
        MIS_CLIENT_IMPORT_FILE_RETENTION_DAYS: '14',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(14);
  });

  it('falls back on garbage / non-positive', () => {
    expect(
      resolveImportFileRetentionDays({
        MIS_CLIENT_IMPORT_FILE_RETENTION_DAYS: '0',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(7);
  });
});

describe('import file retention UI rules', () => {
  const now = Date.parse('2026-07-27T10:00:00+05:30');

  it('locks actions after 7 days even if path still set', () => {
    expect(
      canManageImportFile({
        uploadedAt: '2026-06-25T12:00:00.000Z',
        fileRetained: true,
        storedFilePath: 'coke/x/file.xlsx',
        nowMs: now,
      })
    ).toBe(false);
    expect(isImportFilePastRetention('2026-06-25T12:00:00.000Z', 7, now)).toBe(true);
  });

  it('allows download/delete inside window when file is retained', () => {
    expect(
      canManageImportFile({
        uploadedAt: '2026-07-24T12:00:00.000Z',
        fileRetained: true,
        nowMs: now,
      })
    ).toBe(true);
  });

  it('blocks when file already purged inside window', () => {
    expect(
      canManageImportFile({
        uploadedAt: '2026-07-24T12:00:00.000Z',
        fileRetained: false,
        nowMs: now,
      })
    ).toBe(false);
  });

  it('explains retention on unavailable label', () => {
    expect(IMPORT_FILE_UNAVAILABLE_LABEL).toBe('Unavailable');
    expect(importFileRetentionTooltip()).toBe('Kept for 7 days only');
  });
});
