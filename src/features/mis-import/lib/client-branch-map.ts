/**
 * Coke / Cadbury import entity or state → WRL CRM branch label.
 * Matches BD MIS Format.xlsx Code sheet used for MIS client imports.
 */
export const CLIENT_IMPORT_BRANCH_BY_STATE: Readonly<Record<string, string>> = {
  'a.p': '1181 - VIJAYAWADA BRANCH',
  bihar: '1182 - PATNA BRANCH',
  delhi: '1173 - DELHI BRANCH',
  haryana: '1167 - LUDHIANA BRANCH',
  'j&k': '1164 - JAMMU BRANCH',
  jharkhand: '1150 - RANCHI BRANCH',
  karnataka: '1152 - BANGALORE BRANCH',
  kerala: '1157 - COCHIN BRANCH',
  nesa: '1127 - GUWAHATI BRANCH',
  orissa: '1176 - BHUBANESWAR BRANCH',
  pondicherry: '1159 - CHENNAI BRANCH',
  rajasthan: '1163 - JAIPUR BRANCH',
  't.n': '1159 - CHENNAI BRANCH',
  'w.b': '1154 - KOLKATA BRANCH',
  'vijaywada beverage': '1181 - VIJAYAWADA BRANCH',
  'vizag beverage': '1181 - VIJAYAWADA BRANCH',
  'chittoor beverage': '1181 - VIJAYAWADA BRANCH',
  'ameenpur beverage': '1162 - HYDERABAD BRANCH',
  'moula ali beverage': '1162 - HYDERABAD BRANCH',
};

/** Office id → branch label (subset used by Coke/Cadbury imports). */
export const CLIENT_IMPORT_BRANCH_BY_OFFICE_ID: Readonly<Record<string, string>> = {
  '1127': '1127 - GUWAHATI BRANCH',
  '1150': '1150 - RANCHI BRANCH',
  '1152': '1152 - BANGALORE BRANCH',
  '1154': '1154 - KOLKATA BRANCH',
  '1157': '1157 - COCHIN BRANCH',
  '1159': '1159 - CHENNAI BRANCH',
  '1162': '1162 - HYDERABAD BRANCH',
  '1163': '1163 - JAIPUR BRANCH',
  '1164': '1164 - JAMMU BRANCH',
  '1167': '1167 - LUDHIANA BRANCH',
  '1173': '1173 - DELHI BRANCH',
  '1176': '1176 - BHUBANESWAR BRANCH',
  '1181': '1181 - VIJAYAWADA BRANCH',
  '1182': '1182 - PATNA BRANCH',
};

export function looksLikeWrlBranchLabel(value: string): boolean {
  const text = value.trim();
  return /^\d+\s*-\s*.+\s+BRANCH$/i.test(text) || /^\d+\s*-/.test(text);
}

export function resolveClientImportPlant(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (looksLikeWrlBranchLabel(text)) return text;
  return CLIENT_IMPORT_BRANCH_BY_STATE[text.toLowerCase()] ?? null;
}

export function resolveClientImportPlantFromOfficeId(
  officeId: string | null | undefined
): string | null {
  const id = officeId?.trim();
  if (!id) return null;
  return CLIENT_IMPORT_BRANCH_BY_OFFICE_ID[id] ?? null;
}
