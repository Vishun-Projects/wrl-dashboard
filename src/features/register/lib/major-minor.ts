/** Matches register UI: any major repair fault → Major, else Minor. */
export function formatRegisterMajorMinor(row: Record<string, unknown>): 'Major' | 'Minor' {
  const v = row.is_major_repair ?? row.is_major;
  if (v === true || v === 'True' || v === '1' || v === 1) return 'Major';
  return 'Minor';
}
