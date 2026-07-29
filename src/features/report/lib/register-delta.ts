import { adjustRegisterSummaryBucket } from '@/features/report/lib/report-page-helpers';
import { isAnyFilterActive } from '@/features/report/lib/filters';
import {
  classifyRegisterRowStatus,
  isRegisterRowOpenForMis,
  isRegisterRowSolvedForMis,
  isRegisterRowTransferred,
  registerRowMatchesViewFilters,
  type RegisterSummary,
  type RegisterViewFilterParts,
} from '@/features/report/lib/search';

function findRowIndex(rows: Record<string, unknown>[], rec: Record<string, unknown>): number {
  return rows.findIndex(
    (r) =>
      String(r.UniqueCallNo) === String(rec.UniqueCallNo) ||
      String(r.vcclid) === String(rec.vcclid)
  );
}

function isCancelledForDelta(rec: Record<string, unknown>): boolean {
  return !isRegisterRowTransferred(rec) && classifyRegisterRowStatus(rec) === 'cancelled';
}

export type RegisterDeltaMergeInput = {
  currentData: Record<string, unknown>[];
  currentTotal: number;
  currentRegisterSummary: RegisterSummary | null;
  currentSummaryData: Array<Record<string, unknown>>;
  currentAccountsData: Array<Record<string, unknown>>;
  newRecords: Record<string, unknown>[];
  filterCtx: RegisterViewFilterParts;
};

export type RegisterDeltaMergeResult =
  | { kind: 'noop' }
  | { kind: 'viewFiltered'; updatedData: Record<string, unknown>[] }
  | {
      kind: 'full';
      updatedData: Record<string, unknown>[];
      nextTotal: number;
      nextSummary: RegisterSummary | null;
      nextSummaryData: Array<Record<string, unknown>>;
      nextAccountsData: Array<Record<string, unknown>>;
    };

/** Pure register live-sync merge (row patch + summary/account bucket bumps). */
export function mergeRegisterDeltaRecords(
  input: RegisterDeltaMergeInput
): RegisterDeltaMergeResult {
  const {
    currentData,
    currentTotal,
    currentRegisterSummary,
    currentSummaryData,
    currentAccountsData,
    newRecords,
    filterCtx,
  } = input;
  if (newRecords.length === 0) return { kind: 'noop' };

  const viewFiltered = isAnyFilterActive(filterCtx);
  const updatedData = [...currentData];
  let newAddedCount = 0;
  let dataChanged = false;

  newRecords.forEach((newRec) => {
    const idx = findRowIndex(updatedData, newRec);
    if (idx > -1) {
      updatedData[idx] = newRec;
      dataChanged = true;
      return;
    }

    if (viewFiltered) {
      if (registerRowMatchesViewFilters(newRec, filterCtx)) {
        updatedData.unshift(newRec);
        newAddedCount++;
        dataChanged = true;
      }
      return;
    }

    updatedData.unshift(newRec);
    newAddedCount++;
    dataChanged = true;
  });

  if (!dataChanged) return { kind: 'noop' };

  if (!viewFiltered) {
    updatedData.sort((a, b) => {
      const dateA = new Date(String(a.callsdtrndate || 0)).getTime();
      const dateB = new Date(String(b.callsdtrndate || 0)).getTime();
      return dateB - dateA;
    });
  }

  if (viewFiltered) {
    return { kind: 'viewFiltered', updatedData };
  }

  const recordsForSummary = newRecords;

  const nextSummaryData = [...currentSummaryData];
  recordsForSummary.forEach((newRec) => {
    if (isRegisterRowTransferred(newRec)) return;
    const branchRowIdx = nextSummaryData.findIndex(
      (b) =>
        b.officeId === newRec.nofficeid ||
        String(b.branch ?? '').toLowerCase() === String(newRec.officename ?? '').toLowerCase()
    );
    if (branchRowIdx > -1) {
      const row = { ...nextSummaryData[branchRowIdx] };
      const oldRec = currentData.find(
        (r) =>
          String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
          String(r.vcclid) === String(newRec.vcclid)
      );
      if (oldRec) {
        if (isRegisterRowSolvedForMis(oldRec))
          row.solved_calls = Math.max(0, Number(row.solved_calls || 0) - 1);
        else if (isCancelledForDelta(oldRec))
          row.cancelled_calls = Math.max(0, Number(row.cancelled_calls || 0) - 1);
        else if (isRegisterRowOpenForMis(oldRec))
          row.open_calls = Math.max(0, Number(row.open_calls || 0) - 1);
      }
      if (isRegisterRowSolvedForMis(newRec)) row.solved_calls = Number(row.solved_calls || 0) + 1;
      else if (isCancelledForDelta(newRec))
        row.cancelled_calls = Number(row.cancelled_calls || 0) + 1;
      else if (isRegisterRowOpenForMis(newRec)) row.open_calls = Number(row.open_calls || 0) + 1;
      nextSummaryData[branchRowIdx] = row;
    }
  });

  const nextAccountsData = [...currentAccountsData];
  recordsForSummary.forEach((newRec) => {
    if (isRegisterRowTransferred(newRec)) return;
    const accRowIdx = nextAccountsData.findIndex(
      (a) =>
        String(a.account ?? '').toLowerCase() === String(newRec.PartyName ?? '').toLowerCase()
    );
    if (accRowIdx > -1) {
      const row = { ...nextAccountsData[accRowIdx] };
      const oldRec = currentData.find(
        (r) =>
          String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
          String(r.vcclid) === String(newRec.vcclid)
      );
      if (oldRec) {
        if (isRegisterRowSolvedForMis(oldRec))
          row.total_solved = Math.max(0, Number(row.total_solved || 0) - 1);
        else if (isCancelledForDelta(oldRec))
          row.cancelled_calls = Math.max(0, Number(row.cancelled_calls || 0) - 1);
        else if (isRegisterRowOpenForMis(oldRec))
          row.open_calls = Math.max(0, Number(row.open_calls || 0) - 1);
      }
      if (isRegisterRowSolvedForMis(newRec)) row.total_solved = Number(row.total_solved || 0) + 1;
      else if (isCancelledForDelta(newRec))
        row.cancelled_calls = Number(row.cancelled_calls || 0) + 1;
      else if (isRegisterRowOpenForMis(newRec)) row.open_calls = Number(row.open_calls || 0) + 1;
      nextAccountsData[accRowIdx] = row;
    }
  });

  let nextSummary = currentRegisterSummary ? { ...currentRegisterSummary } : null;
  if (nextSummary) {
    let newTotal = nextSummary.total;

    recordsForSummary.forEach((newRec) => {
      if (classifyRegisterRowStatus(newRec) === 'transferred') return;
      const oldRec = currentData.find(
        (r) =>
          String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
          String(r.vcclid) === String(newRec.vcclid)
      );
      if (oldRec) {
        adjustRegisterSummaryBucket(nextSummary!, classifyRegisterRowStatus(oldRec), -1);
      } else {
        newTotal++;
      }

      adjustRegisterSummaryBucket(nextSummary!, classifyRegisterRowStatus(newRec), 1);
    });

    nextSummary = {
      ...nextSummary!,
      total: newTotal,
    };
  }

  return {
    kind: 'full',
    updatedData,
    nextTotal: currentTotal + newAddedCount,
    nextSummary,
    nextSummaryData,
    nextAccountsData,
  };
}
