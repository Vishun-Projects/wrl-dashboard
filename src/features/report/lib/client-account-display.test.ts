import { describe, expect, it } from 'vitest';
import {
  accountsMatchDisplayOrKey,
  clientAccountDisplayName,
} from '@/features/report/lib/client-account-display';

describe('clientAccountDisplayName', () => {
  it('maps Cadbury variants to Mondelez', () => {
    expect(clientAccountDisplayName('Cadbury')).toBe('Mondelez');
    expect(clientAccountDisplayName('CADBURY')).toBe('Mondelez');
    expect(clientAccountDisplayName('cadbury')).toBe('Mondelez');
  });

  it('maps Coke variants to HCCB', () => {
    expect(clientAccountDisplayName('Coke')).toBe('HCCB');
    expect(clientAccountDisplayName('COKE')).toBe('HCCB');
    expect(clientAccountDisplayName('coke')).toBe('HCCB');
  });

  it('leaves other accounts unchanged', () => {
    expect(clientAccountDisplayName('Nestle')).toBe('Nestle');
    expect(clientAccountDisplayName('Reliance')).toBe('Reliance');
  });
});

describe('accountsMatchDisplayOrKey', () => {
  it('matches raw keys case-insensitively', () => {
    expect(accountsMatchDisplayOrKey('CADBURY', 'Cadbury')).toBe(true);
    expect(accountsMatchDisplayOrKey('coke', 'COKE')).toBe(true);
  });

  it('matches display aliases to raw keys', () => {
    expect(accountsMatchDisplayOrKey('Mondelez', 'CADBURY')).toBe(true);
    expect(accountsMatchDisplayOrKey('HCCB', 'coke')).toBe(true);
    expect(accountsMatchDisplayOrKey('cadbury', 'Mondelez')).toBe(true);
  });

  it('does not cross-match unrelated accounts', () => {
    expect(accountsMatchDisplayOrKey('Mondelez', 'Nestle')).toBe(false);
    expect(accountsMatchDisplayOrKey('HCCB', 'Cadbury')).toBe(false);
  });
});
