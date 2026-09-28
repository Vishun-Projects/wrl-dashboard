/** Filter mapping only — rows keep the original CRM reason text. */

export const BLANK_REASON_KEY = '(blank)';

/** Known groups from live vhorejectreason / vBMrejectreason (currently-rejected, 2026-07+). */
const PRETTY: Record<string, string> = {
  'missing photo': 'Missing Photo',
  'unclear photo': 'Unclear Photo',
  'wrong photo': 'Wrong Photo',
  photo: 'Photo',
  serial: 'Serial Number',
  'false call': 'False / Dummy Call',
  'not attended': 'Not Attended',
  'machine not found': 'Machine Not Found',
  'wrong close': 'Wrong Close',
  drier: 'Drier Not Changed',
  'wrong gas': 'Wrong Gas',
  feedback: 'Feedback',
  invoice: 'Invoice',
  video: 'Video',
  'not cleaned': 'Not Cleaned',
};

/** SQL LIKE needles per canonical token — includes the typos in CRM. */
const NEEDLES: Record<string, string[]> = {
  missing: [
    'MISSING',
    'BLANK',
    'BLANCK',
    'BLACNK',
    'BALANCK',
    'BALNK',
    'BLACK',
    'AVAILABLE',
    'AVILABLE',
    'AVL',
    'UPLOADED',
    'UPLOD',
    'ATTACHED',
    'NO PHOTO',
    'NO PHOTOS',
  ],
  photo: ['PHOTO', 'PHOTOS', 'PHT', 'PHTO', 'PHTOTO', 'PHPTO', 'PICTURE', 'IMAGE', 'PHOTOGRAPHY'],
  unclear: ['CLEAR', 'CELAER', 'CELAR', 'CLARITY', 'PROPER'],
  wrong: ['WRONG', 'INCORRECT', 'INCPORRECT', 'INMCORRECT', 'NOT CORRECT', 'NOT MATCH', 'MISMATCH'],
  serial: [
    'SERIAL',
    'SRIAL',
    'SR NO',
    'SR  NO',
    'SRN O',
    'SL NO',
    'SL NUMBER',
    'SRNO',
    'MACHINE NUMBER',
    'BAR CODE',
    'BARCODE',
    'S/N',
  ],
  'false call': ['FALSE CALL', 'FALSE CALLS', 'DUMMY CALL', 'TRIAL CALL', 'TEST CALL', 'FALSE UPDATE', 'WRONG CALL', 'CALL CANCEL', 'REPEATED'],
  'not attended': [
    'NOT ATTEND',
    'NOT ATTEEND',
    'VISIT NOT',
    'VISI NOT',
    'ON SIDE NOT',
    'CAL NOT ATTEND',
  ],
  'machine not found': ['MC NOT FOUND', 'M C NOT FOUND', 'NOT FOUND', 'NOT FAOUND'],
  'wrong close': [
    'WRONG CLOSE',
    'WRONG CLOSED',
    'WRONG CLOSER',
    'WRONGLY CLOSED',
    'WRONG CALL CLOSED',
    'WRONG COMPLAIN CLOSER',
  ],
  drier: ['DRIER', 'DREIRR'],
  gas: ['WRONG GAS', 'GAS USED', 'GAS USE'],
  feedback: ['FEEDBACK', 'REMARK'],
  invoice: ['INVOICE'],
  video: ['VIDEO'],
  cleaned: ['NOT CLEAN', 'NOT DONE PROPERLY', 'PROBLEM NOT SOLVED', 'SERVICE NOT DONE'],
};

const TYPOS: [RegExp, string][] = [
  [/\bphtoto\b/g, 'photo'],
  [/\bphto\b/g, 'photo'],
  [/\bphpto\b/g, 'photo'],
  [/\bphotography\b/g, 'photo'],
  [/\bpictures?\b/g, 'photo'],
  [/\bimages?\b/g, 'photo'],
  [/\bpics?\b/g, 'photo'],
  [/\bphotos?\b/g, 'photo'],
  [/\bblanks\b/g, 'blank'],
  [/\bblanck\b/g, 'blank'],
  [/\bblacnk\b/g, 'blank'],
  [/\bbalanck\b/g, 'blank'],
  [/\bbalnk\b/g, 'blank'],
  [/\bblack\b/g, 'blank'],
  [/\bcelaer\b/g, 'clear'],
  [/\bcelar\b/g, 'clear'],
  [/\bclarity\b/g, 'clear'],
  [/\bavilable\b/g, 'available'],
  [/\bavl\.?\b/g, 'available'],
  [/\buplod\b/g, 'uploaded'],
  [/\bhsared\b/g, 'shared'],
  [/\bisue\b/g, 'issue'],
  [/\bsrial\b/g, 'serial'],
  [/\bincporrect\b/g, 'incorrect'],
  [/\binmcorrect\b/g, 'incorrect'],
  [/\bworing\b/g, 'wrong'],
  [/\bwroing\b/g, 'wrong'],
  [/\bsr\s*n\s*o\b/g, 'serial'],
  [/\bsr\s*no\b/g, 'serial'],
  [/\bsl\s*no\b/g, 'serial'],
  [/\bsl\s*number\b/g, 'serial'],
  [/\bserial\s*numbers?\b/g, 'serial'],
  [/\bmachine\s*numbers?\b/g, 'serial'],
  [/\bmachine\s*serial\b/g, 'serial'],
  [/\bmodel\s*serial\b/g, 'serial'],
  [/\bbar\s*codes?\b/g, 'serial'],
  [/\bbarcode\b/g, 'serial'],
  [/\bmiss?\s*mat(?:ch|cj|ach|a?tch)?\b/g, 'mismatch'],
  [/\bmis\s*mach\b/g, 'mismatch'],
  [/\bmia\s*matach\b/g, 'mismatch'],
  [/\bmiach\b/g, 'mismatch'],
  [/\bmismttch\b/g, 'mismatch'],
  [/\bmissmatch(?:ed)?\b/g, 'mismatch'],
  [/\bmismatched\b/g, 'mismatch'],
  [/\bnot\s*match(?:ed)?\b/g, 'mismatch'],
  [/\bnot\s*okey\b/g, 'mismatch'],
  [/\bnot\s*correct\b/g, 'wrong'],
  [/\bincorrect(?:ly)?\b/g, 'wrong'],
  [/\bm\s*c\s*not\s*found\b/g, 'machine_not_found'],
  [/\bmc\s*not\s*found\b/g, 'machine_not_found'],
  [/\bnot\s*faound\b/g, 'not found'],
  [/\bcal\s+not\s+attend\b/g, 'not_attended'],
  [/\bnot\s+atteend\b/g, 'not_attended'],
  [/\bnot\s+attend(?:ed)?\b/g, 'not_attended'],
  [/\bcall\s+attended\b/g, 'not_attended'],
  [/\bvc\s+not\s+found\b/g, 'not_attended'],
  [/\bwrong(?:ly)?\s+(?:call\s+)?(?:complain\s+)?clos(?:e|ed|er)\b/g, 'wrong_close'],
  [/\bfalse\s+update\b/g, 'false_call'],
  [/\bwrong\s+calls?\b/g, 'false_call'],
  [/\bcall\s+cancel(?:led|ed)?\b/g, 'false_call'],
  [/\brepeated\b/g, 'false_call'],
  [/\bwrong\s+update\b/g, 'feedback'],
  [/\bwrong\s+machine\s+details\b/g, 'serial'],
  [/\bpropery\b/g, 'properly'],
  [/\bvisits?\s+not\s+(?:done|found)\b/g, 'not_attended'],
  [/\bon\s+side\s+not\s+done\b/g, 'not_attended'],  
  [/\bvisi\s+not\b/g, 'not_attended'],
  [/\bfalse\s+calls?\b/g, 'false_call'],
  [/\bdummy\s+calls?\b/g, 'false_call'],
  [/\btrial\s+calls?\b/g, 'false_call'],
  [/\btest\s+calls?\b/g, 'false_call'],
  [/\bdreirr?\b/g, 'drier'],
  [/\bnot\s+uploaded\b/g, 'missing'],
  [/\bnot\s+attached\b/g, 'missing'],
  [/\bnot\s+available\b/g, 'missing'],
  [/\bno\s+photo\b/g, 'missing photo'],
];

function fold(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/&nbsp;|&#\w+;/g, ' ')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [re, rep] of TYPOS) s = s.replace(re, ` ${rep} `);
  return s.replace(/\s+/g, ' ').trim();
}

function title(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

export function reasonGroupKey(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t || t.toLowerCase() === BLANK_REASON_KEY) return BLANK_REASON_KEY;
  const s = fold(t);
  if (!s) return BLANK_REASON_KEY;
  if (/\bfalse_call\b/.test(s)) return 'false call';
  if (/\bnot_attended\b/.test(s)) return 'not attended';
  if (/\bmachine_not_found\b/.test(s) || /\bmc not found\b/.test(s)) return 'machine not found';
  if (/\bserial\b/.test(s)) return 'serial';
  if (/\bdrier\b/.test(s)) return 'drier';
  if (/\bvideo\b/.test(s)) return 'video';
  if (/\binvoice\b/.test(s)) return 'invoice';
  if (/\bwrong gas\b|\bgas used\b|\bgas use\b|\bgas charging kit\b/.test(s)) return 'wrong gas';
  if (/\bphoto\b/.test(s)) {
    if (/\bblank\b|\bmissing\b|\bavailable\b/.test(s)) return 'missing photo';
    if (/\bclear\b|\bproper\b/.test(s)) return 'unclear photo';
    if (/\bwrong\b|\bmismatch\b/.test(s)) return 'wrong photo';
    return 'photo';
  }
  if (/\bclear\b/.test(s)) return 'unclear photo';
  if (/\bwrong_close\b/.test(s)) return 'wrong close';
  if (/\bfeedback\b|\bremark\b/.test(s)) return 'feedback';
  if (/\bnot clean|\bnot done properly|\bproblem not solved|\bservice not done/.test(s)) {
    return 'not cleaned';
  }
  if (/\bnot found\b/.test(s)) return 'machine not found';
  const leftover = s
    .split(' ')
    .filter((w) => w && w.length > 1)
    .sort();
  return leftover.length ? leftover.join(' ') : BLANK_REASON_KEY;
}

export function prettyReasonLabel(key: string): string {
  if (key === BLANK_REASON_KEY) return '(blank)';
  return PRETTY[key] ?? key.split(/\s+/).filter(Boolean).map(title).join(' ');
}

export function reasonGroupTokens(key: string): string[] {
  if (key === BLANK_REASON_KEY) return [];
  if (key === 'false call') return ['false call'];
  if (key === 'not attended') return ['not attended'];
  if (key === 'machine not found') return ['machine not found'];
  if (key === 'wrong close') return ['wrong close'];
  if (key === 'wrong gas') return ['gas'];
  if (key === 'not cleaned') return ['cleaned'];
  if (key === 'unclear photo') return ['unclear', 'photo'];
  if (key === 'missing photo') return ['missing', 'photo'];
  if (key === 'wrong photo') return ['wrong', 'photo'];
  return key.split(/\s+/).filter((t) => /^[a-z0-9]+$/.test(t) || t.includes(' '));
}

export function reasonTokenNeedles(token: string): string[] {
  const canon = token.toLowerCase();
  if (NEEDLES[canon]) return NEEDLES[canon];
  return [canon.toUpperCase()].filter((n) => n.length >= 3);
}

export type ReasonFilterOption = { key: string; label: string; count: number };

export function groupReasonBuckets(
  items: { label: string; count: number }[]
): ReasonFilterOption[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = reasonGroupKey(item.label);
    map.set(key, (map.get(key) ?? 0) + item.count);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: prettyReasonLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
