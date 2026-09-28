import { describe, expect, it } from 'vitest';
import {
  groupReasonBuckets,
  prettyReasonLabel,
  reasonGroupKey,
} from './reason-groups';

/** Distinct currently-rejected CRM labels (2026-07+, excluding the 1484 blanks). */
const CRM_LABELS = [
  'Blank photo',
  'blanks photo',
  'Photo not clear',
  'False call',
  'MC NOT FOUND',
  'Blanck photo',
  'call not attended',
  'photo not proper',
  'sr no mismatch',
  'drier not changed',
  'SERIAL NUMBER MISS MATCH',
  'Wrong SL Number Update',
  'Wrong Call Closed',
  'Not Proper feedback',
  'Serial No missing',
  'srial number mis match',
  'CALL NOT ATTEND',
  'Srial number mis mach',
  'Visit not Done',
  'Wrong Closer',
  'Srial number mis',
  'Srial number miss match',
  'Balanck photo',
  'photo not celaer',
  'DRIER NOT CHANGE',
  'False calls',
  'SR NO',
  'Srial number miss mtach',
  'photo issue',
  'not attended',
  'Model Serial Number Mismatch',
  'sr no not okey',
  'Blanck phto',
  'Machine Serial Number Mismatch',
  'NOT CLEAN PROPERLY',
  'On Side Not Done',
  'Wrong Serial No Uploaded',
  'Black photo',
  'Serial Number Mismatch',
  'VC Not faound',
  'Srial number mis matach',
  'blanks photo not proper out let photo showing',
  'Capillary use in charging line',
  'drier not changed and photos issue',
  'no clarity',
  'no mc sr no showing not proper photo',
  'NOT DONE PROPERLY',
  'NOT FOUND',
  'photo incorrect',
  'photo to phpto',
  'picture not avl.',
  'Picture not clear',
  'SERIAL NO NOT AVL',
  'serial number missmatch',
  'sr  no issue',
  'woring sr no call  closed',
  'Wrong serial number',
  'Wrongly Closed',
  'CALL COMI NG REPEATED',
  'NOT CLEAN PROPERY',
  'photo',
  'Require Photo Not Avilable',
  'Serial No mismatch',
  'Srial number mia matach',
  'Wrong bar code update',
  'Wrong serial No',
  'wrong serial number photo upload',
  'Wrong Serial Number Registered',
  'attached photo is not correct. rejected',
  'Call Cancel',
  'Dummy Call',
  'False Update',
  'machine number missing',
  'mismatch sr no',
  'photo not showing',
  'Photo not uploaded',
  'S/n Photo not available so rejected',
  'srial number miss matach',
  'video not hsared',
  'Visi not Faound',
  'wrong gas gas use in this unit',
  'Black phto',
  'incporrect serial number',
  'm c not found',
  'Not Proper Photography',
  'outlet photo mismatch',
  'Photos not clear',
  'SR NO MISMTTCH',
  'wroing way to gas charegs dreirr not change as per photo',
  'wrong gas use in this machine',
  'Blacnk photo',
  'drier not changed and leakage video not share',
  'Motor photo not avl',
  'photo not attached',
  'Picture not match',
  'Problem Not solved',
  'Serial mismatch',
  'SERIAL NO MISMATCHED',
  'Serial Number Missing',
  'SERIAL NUMBER NOT PROPER',
  'Srial no mis not',
  'Srial number miach',
  'wrong call',
  'Wrong feedback update',
  'Wrong serial no updated',
  'Wrong Update',
  'Balanck phtoto',
  'drier not reject',
  'Dummy Call Created for Tech Knowledge',
  'machine number na',
  'No complain Machin working fine',
  'Photo Not Avilable',
  'Photo not celar',
  'Serial no picture not attached',
  'Service not done',
  'SR NO NOT MATCH',
  'sr no wrong',
  'Visit not done so cancealed call',
  'Wrong Complain Closer',
  'Wrong Consumption',
  'wrong photos added',
  'Wrong Remark',
  'Balnk photo',
  'cal not attend',
  'gas charging kit not avl',
  'No Proper Photo',
  'no serial number rejected',
  'photo isue',
  'picture not avl',
  'Serial No not match',
  'SERIAL NUMBER NOT MATCH',
  'Srial Number not mis',
  'Srial number not sho',
  'Wrong closed',
  'wrong gas used',
  'Wrong pictures',
  'Wrong Serial No Call',
  'ALL PHOTO NOT PROPER SHOWING',
  'call attended',
  'CALL NOT ATTEEND',
  'incorrect sl no attached',
  'inmcorrect serial number',
  'No photos',
  'NOT  ATTENDED',
  'not proper photo',
  'photos issue',
  'SERIAL NUMBER MISS MATCJ',
  'sr n o',
  'wrong  photo paste',
  'wrong machine details attached',
  'wrong photos',
];

describe('rejected-calls reason groups from live CRM text', () => {
  it('folds blank/black/blanck photo typos into Missing Photo', () => {
    for (const label of [
      'Blank photo',
      'blanks photo',
      'Blanck photo',
      'Black photo',
      'Balnk photo',
      'Blanck phto',
      'Photo not uploaded',
      'No photos',
      'picture not avl.',
    ]) {
      expect(reasonGroupKey(label), label).toBe('missing photo');
    }
    expect(prettyReasonLabel('missing photo')).toBe('Missing Photo');
  });

  it('folds not-clear / not-proper photo into Unclear Photo', () => {
    for (const label of [
      'Photo not clear',
      'photo not celaer',
      'Photo not celar',
      'photo not proper',
      'not proper photo',
    ]) {
      expect(reasonGroupKey(label), label).toBe('unclear photo');
    }
  });

  it('folds wrong/incorrect photo wording into Wrong Photo without rewriting the source', () => {
    for (const label of [
      'wrong Photo',
      'WRONG Photo',
      'Photo Wrong',
      'wrong photos',
      'Wrong pictures',
      'wrong  photo paste',
      'photo incorrect',
    ]) {
      expect(reasonGroupKey(label), label).toBe('wrong photo');
    }
  });

  it('folds serial / sr no / srial mismatch typos into Serial Number', () => {
    for (const label of [
      'sr no mismatch',
      'SERIAL NUMBER MISS MATCH',
      'srial number mis match',
      'Srial number mis mach',
      'Wrong SL Number Update',
      'Wrong serial No',
      'SR NO',
      'sr n o',
      'mismatch sr no',
      'Wrong bar code update',
    ]) {
      expect(reasonGroupKey(label), label).toBe('serial');
    }
    expect(prettyReasonLabel('serial')).toBe('Serial Number');
  });

  it('collapses the live 152 labels into a short filter list', () => {
    const grouped = groupReasonBuckets(CRM_LABELS.map((label) => ({ label, count: 1 })));
    const keys = grouped.map((g) => g.key);
    expect(keys).toContain('missing photo');
    expect(keys).toContain('serial');
    expect(keys).toContain('false call');
    expect(keys).toContain('not attended');
    expect(keys).toContain('drier');
    expect(reasonGroupKey('Wrong Call Closed')).toBe('wrong close');
    expect(grouped.length).toBeLessThanOrEqual(20);
    expect(grouped.length).toBeLessThan(CRM_LABELS.length / 4);
  });
});
