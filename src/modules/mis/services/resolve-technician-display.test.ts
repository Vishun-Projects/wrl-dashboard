import { describe, expect, it } from 'vitest';
import { resolveTechnicianDisplayName, rowMatchesTechnicianFilter } from './filters';

describe('resolveTechnicianDisplayName', () => {
  it('prefers this call engineer_name over roster first-seen for same truncated id', () => {
    const roster = [{ value: '108.3', label: 'Chhotu Kumar' }];
    expect(
      resolveTechnicianDisplayName(
        { nengineer: 108.2, serviceman: 'Mithlesh Kumar Sah' },
        roster
      )
    ).toBe('Mithlesh Kumar Sah');
  });

  it('falls back to roster when row name blank', () => {
    const roster = [{ value: '108.2', label: 'Mithlesh Kumar Sah' }];
    expect(resolveTechnicianDisplayName({ nengineer: '108.200000000' }, roster)).toBe(
      'Mithlesh Kumar Sah'
    );
  });
});

describe('rowMatchesTechnicianFilter', () => {
  it('matches fractional engineer ids numerically', () => {
    expect(
      rowMatchesTechnicianFilter({ nengineer: '108.200000000', serviceman: 'Mithlesh' }, ['108.2'])
    ).toBe(true);
    expect(
      rowMatchesTechnicianFilter({ nengineer: '108.200000000', serviceman: 'Mithlesh' }, ['108.3'])
    ).toBe(false);
  });
});
