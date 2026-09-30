import {
  classifySpareLoanRow,
  lookupCallsByVtrnno,
  lookupPlantMeta,
  selectMatchKey,
} from '@/modules/spare-loan-check/crm-match';
import {
  lookupItemCategoriesByMaterial,
  normalizeMaterialCode,
} from '@/modules/spare-loan-check/item-group';
import type { Zss02IssueFlag, Zss02Row } from '@/modules/zss02/types';

/** Attach CRM plant name, item group, + cancelled / franchisee-change flags. */
export async function enrichZss02Rows(rows: Zss02Row[]): Promise<Zss02Row[]> {
  if (rows.length === 0) return rows;

  const matchKeys: string[] = [];
  const matches = rows.map((r) => {
    const match = selectMatchKey(r.soLoan, r.soConRtn);
    if (match) matchKeys.push(match.key);
    return match;
  });

  const [callMap, plantMeta, categoryMap] = await Promise.all([
    lookupCallsByVtrnno(matchKeys),
    lookupPlantMeta(rows.map((r) => r.plant)),
    lookupItemCategoriesByMaterial(rows.map((r) => r.material)),
  ]);

  return rows.map((r, i) => {
    const match = matches[i];
    const call = match ? callMap.get(match.key) : undefined;
    const reason = match ? classifySpareLoanRow(r.vendorNo, call) : null;

    let issue: Zss02IssueFlag = null;
    let issueDetail: string | null = null;
    if (reason === 'cancelled' || reason === 'unassigned_cancelled') {
      issue = 'cancelled';
      issueDetail = call?.cancelReason?.trim() || 'Cancelled';
    } else if (reason === 'vendor_mismatch') {
      issue = 'franchisee_change';
      const crm = call?.vendorCode?.trim() || call?.vendorName?.trim() || '—';
      issueDetail = `Franchisee changed (CRM: ${crm})`;
    }

    const meta = plantMeta.get(r.plant.trim());
    const itemGroup =
      categoryMap.get(normalizeMaterialCode(r.material)) ?? null;
    return {
      ...r,
      plantName: meta?.plantName ?? null,
      itemGroup,
      issue,
      issueDetail,
    };
  });
}
