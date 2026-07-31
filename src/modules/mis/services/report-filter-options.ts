import { filterCallsCSR, mergeBranchFilterListEntry } from '@/modules/mis/services/filters';

export type NamedOptionSource = { vname: string };
export type CityOptionSource = { ncode: string; vname: string };
export type TechnicianOptionSource = { ncode: string; vname: string };
export type BranchOptionSource = { ncode: string; vcompanyname: string; call_count?: number };

type CascadeCriteria = {
  state: string[];
  city: string[];
  region: string[];
  account: string[];
  selectedBranch: string[];
  selectedFranchisee: string[];
  technician: string[];
  pincodeSearch: string;
};

type CascadeLists = {
  statesList: Array<{ vname: string; call_count: number }>;
  citiesList: Array<{ ncode: string; vname: string; nstate: string; call_count: number }>;
  regionsList: Array<{ vname: string; call_count: number }>;
  accountsList: Array<{ vname: string; call_count: number }>;
  techniciansList: Array<{ ncode: string; vname: string; call_count: number }>;
  branchesList: BranchOptionSource[];
  franchiseesList: BranchOptionSource[];
};

export type ReportFilterOptions = {
  callTypeOptions: Array<{ value: string; label: string }>;
  stateOptions: Array<{ value: string; label: string }>;
  cityOptions: Array<{ value: string; label: string }>;
  regionOptions: Array<{ value: string; label: string }>;
  accountOptions: Array<{ value: string; label: string }>;
  technicianOptions: Array<{ value: string; label: string }>;
};

export function buildReportFilterOptions(input: {
  callTypes: string[];
  statesList: NamedOptionSource[];
  citiesList: CityOptionSource[];
  regionsList: NamedOptionSource[];
  accountsList: NamedOptionSource[];
  techniciansList: TechnicianOptionSource[];
}): ReportFilterOptions {
  return {
    callTypeOptions: input.callTypes.map((type) => ({ value: type, label: type })),
    stateOptions: input.statesList.map((s) => ({ value: s.vname, label: s.vname })),
    cityOptions: input.citiesList.map((c) => ({ value: c.ncode, label: c.vname })),
    regionOptions: input.regionsList.map((r) => ({ value: r.vname, label: r.vname })),
    accountOptions: input.accountsList.map((a) => ({ value: a.vname, label: a.vname })),
    technicianOptions: input.techniciansList.map((t) => ({ value: t.ncode, label: t.vname })),
  };
}

export function deriveCascadeFilterLists(
  calls: any[],
  baseCriteria: CascadeCriteria
): CascadeLists {
  const statesFiltered = filterCallsCSR(calls, baseCriteria, 'state');
  const stateCounts: Record<string, { vname: string; call_count: number }> = {};
  statesFiltered.forEach((c) => {
    if (!c.state) return;
    const key = String(c.state);
    stateCounts[key] = stateCounts[key] || { vname: key, call_count: 0 };
    stateCounts[key].call_count++;
  });

  const citiesFiltered = filterCallsCSR(calls, baseCriteria, 'city');
  const cityCounts: Record<string, { ncode: string; vname: string; nstate: string; call_count: number }> = {};
  citiesFiltered.forEach((c) => {
    if (!c.city) return;
    const key = String(c.city);
    cityCounts[key] = cityCounts[key] || { ncode: key, vname: key, nstate: String(c.state || ''), call_count: 0 };
    cityCounts[key].call_count++;
  });

  const regionsFiltered = filterCallsCSR(calls, baseCriteria, 'region');
  const regionCounts: Record<string, { vname: string; call_count: number }> = {};
  regionsFiltered.forEach((c) => {
    if (!c.region) return;
    const key = String(c.region);
    regionCounts[key] = regionCounts[key] || { vname: key, call_count: 0 };
    regionCounts[key].call_count++;
  });

  const accountsFiltered = filterCallsCSR(calls, baseCriteria, 'account');
  const accountCounts: Record<string, { vname: string; call_count: number }> = {};
  accountsFiltered.forEach((c) => {
    if (!c.account) return;
    const key = String(c.account);
    accountCounts[key] = accountCounts[key] || { vname: key, call_count: 0 };
    accountCounts[key].call_count++;
  });

  const techFiltered = filterCallsCSR(calls, baseCriteria, 'technician');
  const techCounts: Record<string, { ncode: string; vname: string; call_count: number }> = {};
  techFiltered.forEach((c) => {
    if (!c.nengineer || c.nengineer === '0' || c.nengineer === 0) return;
    const tCode = String(c.nengineer);
    techCounts[tCode] = techCounts[tCode] || { ncode: tCode, vname: c.technician_name || 'UNKNOWN', call_count: 0 };
    techCounts[tCode].call_count++;
  });

  const branchesFiltered = filterCallsCSR(calls, baseCriteria, 'branch');
  const branchCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> = {};
  branchesFiltered.forEach((c) => {
    const bCode = String(c.resolved_branch_code || c.nofficeid || '');
    if (!bCode || bCode === 'UNKNOWN') return;
    mergeBranchFilterListEntry(
      branchCounts,
      String(c.officename || c.office_name || bCode),
      bCode,
      1
    );
  });

  const franchiseesFiltered = filterCallsCSR(calls, baseCriteria, 'franchisee');
  const franchiseeCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> = {};
  franchiseesFiltered.forEach((c) => {
    const fCode = c.franchisee_code ? String(c.franchisee_code) : 'UNASSIGNED';
    franchiseeCounts[fCode] = franchiseeCounts[fCode] || {
      ncode: fCode,
      vcompanyname: c.franchisee_name || fCode,
      call_count: 0,
    };
    franchiseeCounts[fCode].call_count++;
  });

  return {
    statesList: Object.values(stateCounts).sort((a, b) => a.vname.localeCompare(b.vname)),
    citiesList: Object.values(cityCounts).sort((a, b) => a.vname.localeCompare(b.vname)),
    regionsList: Object.values(regionCounts).sort((a, b) => a.vname.localeCompare(b.vname)),
    accountsList: Object.values(accountCounts).sort((a, b) => a.vname.localeCompare(b.vname)),
    techniciansList: Object.values(techCounts).sort((a, b) => a.vname.localeCompare(b.vname)),
    branchesList: Object.values(branchCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname)),
    franchiseesList: Object.values(franchiseeCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname)),
  };
}
