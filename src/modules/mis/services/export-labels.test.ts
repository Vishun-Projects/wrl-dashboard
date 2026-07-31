import { describe, expect, it } from 'vitest';
import { exportLabelForMisTab, resolveExportBranch } from '@/modules/mis/services/export-labels';

describe('exportLabelForMisTab', () => {
  it('labels each MIS tab independently of active tab', () => {
    expect(exportLabelForMisTab('summary')).toBe('Summary Dashboard Excel');
    expect(exportLabelForMisTab('accounts')).toBe('Key Account MIS Excel');
    expect(exportLabelForMisTab('register', 'csv')).toBe('Call Register CSV');
    expect(exportLabelForMisTab('register', 'excel')).toBe('Call Register Excel');
    expect(exportLabelForMisTab('bd_mis_summary')).toBe('BD MIS Summary Excel');
  });
});

describe('resolveExportBranch', () => {
  it('maps frozen source tabs to export branches', () => {
    expect(resolveExportBranch('summary')).toBe('summary');
    expect(resolveExportBranch('accounts')).toBe('accounts');
    expect(resolveExportBranch('register')).toBe('register');
    expect(resolveExportBranch('bd_mis_summary')).toBe('bd_mis_summary');
    expect(resolveExportBranch('client_import')).toBe('unsupported');
  });

  it('keeps summary and register branches distinct when tab switches', () => {
    const enqueuedOnSummary = resolveExportBranch('summary');
    const enqueuedOnRegister = resolveExportBranch('register');
    expect(enqueuedOnSummary).not.toBe(enqueuedOnRegister);
  });
});
