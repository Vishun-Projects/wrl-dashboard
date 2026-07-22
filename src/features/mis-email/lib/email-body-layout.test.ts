import { describe, expect, it } from 'vitest';
import {
  MIS_EMAIL_BODY_LAYOUT_PRESETS,
  composeEmailBodyGridHtml,
  parseMisEmailBodyLayout,
  resolveMisEmailBodyLayout,
} from '@/features/mis-email/lib/email-body-layout';

describe('email-body-layout', () => {
  it('defaults to stacked when layout missing', () => {
    expect(resolveMisEmailBodyLayout(undefined)).toEqual({ mode: 'stacked' });
  });

  it('parses grid layout with placements', () => {
    expect(
      parseMisEmailBodyLayout({
        mode: 'grid',
        columns: 2,
        mergeKeyAccountRegions: true,
        placements: [
          { sectionId: 'regional_performance', col: 1, row: 1 },
          { sectionId: 'invalid', col: 2, row: 1 },
        ],
      })
    ).toEqual({
      mode: 'grid',
      columns: 2,
      mergeKeyAccountRegions: true,
      placements: [{ sectionId: 'regional_performance', col: 1, row: 1 }],
    });
  });

  it('renders stacked sections in order', () => {
    const html = composeEmailBodyGridHtml(
      ['regional_performance', 'branch_performance'],
      {
        regional_performance: '<div id="regional">R</div>',
        branch_performance: '<div id="branch">B</div>',
      },
      { mode: 'stacked' }
    );
    expect(html).toBe('<div id="regional">R</div><div id="branch">B</div>');
  });

  it('renders legacy dashboard as two-column table', () => {
    const layout = MIS_EMAIL_BODY_LAYOUT_PRESETS.legacy_dashboard.layout;
    const html = composeEmailBodyGridHtml(
      ['regional_performance', 'branch_performance', 'key_account_performance'],
      {
        regional_performance: '<div data-section="regional">R</div>',
        branch_performance: '<div data-section="branch">B</div>',
        key_account_performance: '<div data-section="key">K</div>',
      },
      layout
    );
    expect(html).toContain('<table');
    expect(html).not.toContain('rowspan=');
    expect(html).toContain('mis-grid-cell');
    expect(html).toContain('data-section="regional"');
    expect(html).toContain('data-section="branch"');
    expect(html).toContain('data-section="key"');
  });
});
