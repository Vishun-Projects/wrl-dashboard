import { describe, expect, it } from 'vitest';
import { resolveActiveMisTab } from './mis-tab-access';

describe('resolveActiveMisTab', () => {
  it('keeps current tab when still available', () => {
    const next = resolveActiveMisTab(
      'summary',
      [
        { id: 'register' },
        { id: 'summary' },
      ],
      'register'
    );
    expect(next).toBe('summary');
  });

  it('falls back when current tab is no longer available', () => {
    const next = resolveActiveMisTab(
      'bd_mis_summary',
      [{ id: 'register' }, { id: 'summary' }],
      'register'
    );
    expect(next).toBe('register');
  });
});
