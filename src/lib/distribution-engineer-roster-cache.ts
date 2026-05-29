import type { RosterTechnician } from '@/lib/distribution-idle-assignees';

const rosterByBranchId = new Map<string, RosterTechnician[]>();
let inflight: Promise<void> | null = null;
let inflightBranchId: string | null = null;

export function getCachedEngineerRoster(branchId: string): RosterTechnician[] | undefined {
  return rosterByBranchId.get(branchId);
}

export function setCachedEngineerRoster(branchId: string, roster: RosterTechnician[]): void {
  rosterByBranchId.set(branchId, roster);
}

/** One in-flight fetch per branch id — avoids duplicate /api/report/engineers calls. */
export async function loadEngineerRosterForBranch(
  branchId: string,
  fetcher: () => Promise<RosterTechnician[]>
): Promise<RosterTechnician[]> {
  const cached = rosterByBranchId.get(branchId);
  if (cached) return cached;

  if (inflight && inflightBranchId === branchId) {
    await inflight;
    return rosterByBranchId.get(branchId) ?? [];
  }

  inflightBranchId = branchId;
  inflight = (async () => {
    try {
      const roster = await fetcher();
      rosterByBranchId.set(branchId, roster);
    } finally {
      inflight = null;
      inflightBranchId = null;
    }
  })();
  await inflight;
  return rosterByBranchId.get(branchId) ?? [];
}
