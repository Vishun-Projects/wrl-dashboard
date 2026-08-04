import { describe, expect, it } from 'vitest';
import { parseOutlookEmailList } from '@/modules/mis-email/services/parse-outlook-emails';

describe('parseOutlookEmailList', () => {
  it('parses Outlook To/Cc paste with names and angle brackets', () => {
    const raw = `To: 'samiran.m@westernequipments.com' <samiran.m@westernequipments.com>; 'Vijesh Mittal' <vijesh.mittal@westernequipments.com>; lalitkumar.k@westernequipments.com`;
    expect(parseOutlookEmailList(raw)).toEqual([
      'samiran.m@westernequipments.com',
      'vijesh.mittal@westernequipments.com',
      'lalitkumar.k@westernequipments.com',
    ]);
  });

  it('dedupes and lowercases', () => {
    expect(
      parseOutlookEmailList(
        `'Lalit' <LalitKumar.K@westernequipments.com>; lalitkumar.k@westernequipments.com`
      )
    ).toEqual(['lalitkumar.k@westernequipments.com']);
  });
});
