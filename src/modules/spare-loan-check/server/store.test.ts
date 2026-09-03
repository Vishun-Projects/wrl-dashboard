import { describe, expect, it } from 'vitest';
import { selectMatchKey } from '@/modules/spare-loan-check/server/match';

/** Mirrors per-plant tally used before save (no DB). */
function tallyByPlant(
  rows: Array<{ plant: string; soLoan: string; soConRtn: string }>
): Record<string, { parsed: number; skipped: number; keyed: number }> {
  const out: Record<string, { parsed: number; skipped: number; keyed: number }> = {};
  for (const row of rows) {
    const plant = row.plant.trim() || 'UNKNOWN';
    if (!out[plant]) out[plant] = { parsed: 0, skipped: 0, keyed: 0 };
    out[plant].parsed += 1;
    if (selectMatchKey(row.soLoan, row.soConRtn)) out[plant].keyed += 1;
    else out[plant].skipped += 1;
  }
  return out;
}

describe('spare loan plant overwrite key', () => {
  it('groups rows by plant for separate snapshots', () => {
    const tallies = tallyByPlant([
      { plant: '1152', soLoan: '25B22681', soConRtn: '' },
      { plant: '1152', soLoan: 'Buffer', soConRtn: '' },
      { plant: '1101', soLoan: '', soConRtn: '25A00001' },
    ]);
    expect(tallies['1152']).toEqual({ parsed: 2, skipped: 1, keyed: 1 });
    expect(tallies['1101']).toEqual({ parsed: 1, skipped: 0, keyed: 1 });
  });
});
