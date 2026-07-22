import { enrichTrhcallBranchFranchisee } from '@/lib/trhcalls/query';
import { enrichRegisterRowArcpApproveDates } from '@/lib/register-sql/arcp-approve-dates';

export function mapCachedRowToRegisterRow(row: Record<string, unknown>): Record<string, unknown> {
  const pin = row.Pincode ?? row.pincode;
  const base: Record<string, unknown> = {
    ...row,
    UniqueCallNo: row.UniqueCallNo ?? row.vtrnno,
    vcclid: row.vcclid,
    serviceman: row.serviceman ?? row.technician_name,
    Pincode: pin,
    pincode: pin,
    callsvserialno: row.callsvserialno ?? row.vserialno,
    PartyName: row.PartyName ?? row.party_name,
    Status: row.Status ?? row.callstatus,
    callstatus: row.callstatus,
    callsolved: row.callsolved ?? row.bsolved,
    id: row.id ?? row.ncode,
    nofficeid: row.nofficeid,
    office_name: row.office_name ?? row.officename,
    office_under: row.office_under,
    branch_office_name: row.branch_office_name,
    officeId: row.officeId ?? row.nofficeid,
    parentId: row.parentId ?? row.office_under,
    region: row.region,
    account: row.account,
    branch_headcount: row.branch_headcount,
    has_visit: row.has_visit,
    franchisee_name: row.franchisee_name,
    franchisee_code: row.franchisee_code,
    technician_office_name: row.technician_office_name,
    technician_office_id: row.technician_office_id,
    transfer_office_name: row.transfer_office_name,
    ntransfertooffice: row.ntransfertooffice,
    vpersoncalling: row.vpersoncalling,
    vinsttel1: row.vinsttel1,
    vinstaddress: row.vinstaddress,
  };

  return enrichRegisterRowArcpApproveDates(enrichTrhcallBranchFranchisee(base));
}
