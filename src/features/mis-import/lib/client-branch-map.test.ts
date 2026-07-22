import { describe, expect, it } from 'vitest';
import {
  CLIENT_IMPORT_BRANCH_BY_STATE,
  looksLikeWrlBranchLabel,
  resolveClientImportPlant,
} from '@/features/mis-import/lib/client-branch-map';

describe('client-branch-map', () => {
  it('maps Coke entity names to WRL branch labels', () => {
    expect(resolveClientImportPlant('Vijaywada Beverage')).toBe('1181 - VIJAYAWADA BRANCH');
    expect(resolveClientImportPlant('Ameenpur Beverage')).toBe('1162 - HYDERABAD BRANCH');
  });

  it('maps Cadbury state codes to WRL branch labels', () => {
    expect(resolveClientImportPlant('A.P')).toBe('1181 - VIJAYAWADA BRANCH');
    expect(resolveClientImportPlant('BIHAR')).toBe('1182 - PATNA BRANCH');
    expect(resolveClientImportPlant('W.B')).toBe('1154 - KOLKATA BRANCH');
    expect(resolveClientImportPlant('T.N')).toBe('1159 - CHENNAI BRANCH');
    expect(resolveClientImportPlant('NESA')).toBe('1127 - GUWAHATI BRANCH');
    expect(resolveClientImportPlant('JHARKHAND')).toBe('1150 - RANCHI BRANCH');
    expect(resolveClientImportPlant('ORISSA')).toBe('1176 - BHUBANESWAR BRANCH');
  });

  it('keeps already-resolved WRL branch labels', () => {
    const label = '1173 - DELHI BRANCH';
    expect(looksLikeWrlBranchLabel(label)).toBe(true);
    expect(resolveClientImportPlant(label)).toBe(label);
  });

  it('covers every configured client state key', () => {
    expect(Object.keys(CLIENT_IMPORT_BRANCH_BY_STATE).length).toBeGreaterThanOrEqual(19);
  });
});
