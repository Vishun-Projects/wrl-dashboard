import { createHash } from 'crypto';
import type {
  AthenaReconciliationStatus,
  CrmAthenaFailedRow,
} from '@/modules/athena-reconciliation/types';

export const ATHENA_BRANCH_CODE_MAP: Record<string, string> = {
  '1111': 'JAIPUR',
  '1126': 'INDORE',
  '1127': 'GUWAHATI',
  '1128': 'HUBLI',
  '1134': 'RAIPUR',
  '1140': 'AHMEDABAD',
  '1150': 'RANCHI',
  '1151': 'KERALA',
  '1152': 'BANGALORE',
  '1154': 'KOLKATA',
  '1155': 'CHANDIGARH',
  '1156': 'DEHRADUN',
  '1157': 'COCHIN',
  '1158': 'COIMBATORE',
  '1159': 'CHENNAI',
  '1160': 'AGRA',
  '1161': 'GOA',
  '1162': 'HYDERABAD',
  '1163': 'JAIPUR',
  '1164': 'JAMMU',
  '1165': 'PONNAMALLEE',
  '1166': 'LUCKNOW',
  '1167': 'LUDHIANA',
  '1170': 'NAGPUR',
  '1171': 'MUMBAI',
  '1173': 'DELHI',
  '1175': 'PUNE',
  '1176': 'BHUBANESWAR',
  '1181': 'VIJAYAWADA',
  '1182': 'PATNA',
  '2121': 'DELHI',
  '2222': 'MUMBAI',
};

export function cleanText(val: unknown): string | null {
  if (val == null) return null;
  const str = String(val)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // remove non-printable control chars
    .replace(/\s+/g, ' ')
    .trim();
  return str.length > 0 ? str : null;
}

export function resolveBranchName(rawBranch: unknown): string | null {
  const cleaned = cleanText(rawBranch);
  if (!cleaned) return null;
  if (ATHENA_BRANCH_CODE_MAP[cleaned]) {
    return ATHENA_BRANCH_CODE_MAP[cleaned];
  }
  // Strip digits and "BRANCH" suffix if present
  const stripped = cleaned
    .replace(/^\d+\s*-\s*/, '')
    .replace(/\s*BRANCH.*$/i, '')
    .trim();
  return stripped.length > 0 ? stripped : cleaned;
}

export function normalizeKey(val: unknown): string {
  const cleaned = cleanText(val);
  return cleaned ? cleaned.toUpperCase() : '';
}

/**
 * Normalizes machine serial number:
 * Uppercased, trimmed, strips inner extra whitespace without modifying core character sequence.
 */
export function normalizeSerial(val: unknown): string {
  if (val == null) return '';
  const raw = String(val).trim();
  // Strip control chars, trim, uppercase
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Robust date parser supporting Indian format DD/MM/YYYY, ISO, and standard timestamps.
 */
export function parseAthenaDate(rawDate: unknown): Date | null {
  if (!rawDate) return null;
  const str = String(rawDate).trim();
  if (!str || str.toLowerCase() === 'null') return null;

  // DD/MM/YYYY or DD-MM-YYYY with optional time
  const dmyMatch = str.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(AM|PM))?)?$/i
  );
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    let hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const minutes = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const seconds = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const meridiem = dmyMatch[7]?.toUpperCase();

    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;

    const parsed = new Date(year, month, day, hours, minutes, seconds);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Standard ISO / JS Date parser
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

export function computeAthenaRawFingerprint(raw: CrmAthenaFailedRow): string {
  const parts = [
    cleanText(raw.CLIENTTICKETNO) ?? '',
    normalizeSerial(raw.SERIALNO),
    cleanText(raw.RECEIVEDDATE) ?? '',
    cleanText(raw.OUTLETNAME) ?? '',
    cleanText(raw.CALLTYPE) ?? '',
    cleanText(raw.RESULT_VALUE) ?? cleanText(raw.RESULT) ?? '',
    cleanText(raw.addedon) ?? '',
    cleanText(raw.ClientCaption) ?? cleanText(raw.CLIENT) ?? '',
  ];
  return createHash('sha256').update(parts.join('||')).digest('hex');
}

export function extractFailureReason(resultValue: unknown, result: unknown): string {
  const resVal = cleanText(resultValue);
  if (resVal && resVal !== '0' && resVal.toLowerCase() !== 'null') {
    return resVal;
  }
  const res = cleanText(result);
  if (res && res.toLowerCase() !== 'null') {
    return res;
  }
  return 'Unknown Error';
}

export function normalizeAthenaFailedRow(
  id: number,
  raw: CrmAthenaFailedRow,
  fingerprint: string
) {
  const callTypeClean = cleanText(raw.CALLTYPE);
  const outletNameClean = cleanText(raw.OUTLETNAME);
  const serialNoClean = normalizeSerial(raw.SERIALNO);
  const receivedDateParsed = parseAthenaDate(raw.RECEIVEDDATE);
  const addedonParsed = parseAthenaDate(raw.addedon);

  const callDate = receivedDateParsed ?? addedonParsed;
  const failureReason = extractFailureReason(raw.RESULT_VALUE, raw.RESULT);
  const branchName = resolveBranchName(raw.BRANCHNAME);
  const clientCaption = cleanText(raw.ClientCaption) || cleanText(raw.CLIENT) || null;

  // Validate the 4 matching criteria fields
  const missingFields: string[] = [];
  if (!callTypeClean) missingFields.push('CALLTYPE');
  if (!outletNameClean) missingFields.push('OUTLETNAME');
  if (!serialNoClean) missingFields.push('SERIALNO');
  if (!callDate) missingFields.push('CALLDATE/RECEIVEDDATE');

  const isValid = missingFields.length === 0;
  const invalidReason = !isValid ? `Missing required matching field(s): ${missingFields.join(', ')}` : null;
  const initialStatus: AthenaReconciliationStatus = isValid ? 'NOT_REGISTERED' : 'INVALID_DATA';

  return {
    id,
    rawFingerprint: fingerprint,
    clientCaption,
    branchName,
    clientTicketNo: cleanText(raw.CLIENTTICKETNO),
    mcStatus: cleanText(raw.MCSTATUS),
    callType: callTypeClean,
    natureOfComplaint: cleanText(raw.NATUREOFCOMPLAINT),
    outletName: outletNameClean,
    outletAddress: cleanText(raw.OUTLETNAMEADDRESS),
    pincode: cleanText(raw.PINCODE),
    phone: cleanText(raw.PHONE),
    model: cleanText(raw.MODEL),
    serialNo: serialNoClean || null,
    assetNo: cleanText(raw.ASSETNO1),
    invoiceNo: cleanText(raw.INVOICENO),
    productStatus: cleanText(raw.Product_Status),
    result: cleanText(raw.RESULT),
    resultValue: cleanText(raw.RESULT_VALUE),
    failureReason,
    callDate,
    receivedDate: receivedDateParsed,
    addedonAt: addedonParsed,
    isValidMatchingData: isValid,
    invalidReason,
    reconciliationStatus: initialStatus,
  };
}
