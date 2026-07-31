/** Canonical CRM call row field aliases for register, export, and hot transforms. */
export type NormalizedCallRow = Record<string, unknown> & {
  vtrnno: string;
  ncode: string;
  partyName: string;
  pincode: string;
  calltype: string;
};

export function normalizeCrmCallRow(row: Record<string, unknown>): NormalizedCallRow {
  const vtrnno = String(row.UniqueCallNo ?? row.vtrnno ?? row.VTRNNO ?? '').trim();
  const ncode = String(row.ncode ?? row.id ?? '').trim();
  const partyName = String(row.PartyName ?? row.party_name ?? '').trim();
  const pincode = String(row.Pincode ?? row.pincode ?? '').trim();
  const calltype = String(row.calltype ?? row.CallType ?? '').trim();

  return {
    ...row,
    vtrnno,
    ncode,
    partyName,
    pincode,
    calltype,
    UniqueCallNo: row.UniqueCallNo ?? vtrnno,
    PartyName: row.PartyName ?? partyName,
    Pincode: row.Pincode ?? pincode,
  };
}
