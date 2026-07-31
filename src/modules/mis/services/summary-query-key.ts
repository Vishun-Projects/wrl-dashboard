import {
  buildSummaryQueryKey,
  normalizeAgingAsOfDate,
  resolveSummaryOfficeIdsParam,
  resolveViewCallTypesParam,
} from '@/modules/mis/services/filters';

export type SummaryQueryKeyInput = {
  offices: any[];
  selectedBranch: string[];
  selectedFranchisee: string[];
  selectedCallTypes: string[];
  startDateStr: string;
  endDateStr: string;
  agingAsOf: string;
};

export function buildSummaryQueryKeyFromSnapshot(input: SummaryQueryKeyInput): string {
  return buildSummaryQueryKey({
    officeIdsParam: resolveSummaryOfficeIdsParam(
      input.offices,
      input.selectedBranch,
      input.selectedFranchisee
    ),
    callTypesParam: resolveViewCallTypesParam(input.selectedCallTypes),
    startDateStr: input.startDateStr,
    endDateStr: input.endDateStr,
    agingAsOf: normalizeAgingAsOfDate(input.agingAsOf),
  });
}
