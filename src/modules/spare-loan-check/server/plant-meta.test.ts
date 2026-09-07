import { describe, expect, it } from 'vitest';

/** Zone preference: plant map wins over CRM zone. */
function preferZone(
  mapZone: string | null | undefined,
  crmZone: string | null | undefined
): string | null {
  const a = mapZone?.trim() || null;
  const b = crmZone?.trim() || null;
  return a || b;
}

describe('plant meta zone preference', () => {
  it('prefers mis plant map over CRM mstzones', () => {
    expect(preferZone('SOUTH ZONE', 'EAST ZONE')).toBe('SOUTH ZONE');
    expect(preferZone(null, 'EAST ZONE')).toBe('EAST ZONE');
    expect(preferZone('', null)).toBe(null);
  });
});
