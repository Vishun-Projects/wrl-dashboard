import { withAppClient } from '@/lib/read-model/db';
import { parseAsOf, snapExposureUnitYears, type SnapQuery } from '@/modules/warranty-provision/server/snap';
import { getAssumptions } from '@/modules/warranty-provision/server/claims';
import { claimFactRateStats } from '@/modules/warranty-provision/server/claim-facts';
import type { WarrantyRatesResponse } from '@/modules/warranty-provision/types';

const AGE_BAND_ORDER: Record<string, number> = {
  '0-6m': 0,
  '6-12m': 1,
  '12-24m': 2,
  '24-36m': 3,
  '36m+': 4,
  unknown: 5,
};

export async function queryWarrantyRates(q: SnapQuery): Promise<WarrantyRatesResponse> {
  const asOf = parseAsOf(q.asOf);
  const exposureUnitYears = await snapExposureUnitYears({ ...q, asOf });
  const assumptions = await getAssumptions();
  const claimStats = await claimFactRateStats(asOf);

  return withAppClient(async (client) => {
    const { totalClaims, matchedClaims, avgClaimCost } = claimStats;

    const eligible = await client.query<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM warranty_provision_rows
      WHERE warranty_end_date IS NOT NULL AND warranty_end_date > $1::date
      `,
      [asOf]
    );
    const eligibleUnits = Number(eligible.rows[0]?.n ?? 0) || 0;
    const overallClaimPct =
      eligibleUnits > 0 ? (matchedClaims / eligibleUnits) * 100 : null;
    const exposureClaimRate =
      exposureUnitYears > 0 ? matchedClaims / exposureUnitYears : null;

    const claimByGroup = new Map(
      claimStats.byMaterialGroup.map((r) => [r.materialGroup, r])
    );

    const byGroup = await client.query<{
      material_group: string;
      units: string;
    }>(
      `
      SELECT material_group, COUNT(*)::text AS units
      FROM warranty_provision_rows
      WHERE material_group <> ''
      GROUP BY material_group
      ORDER BY COUNT(*) DESC
      LIMIT 50
      `
    );

    const byAgeExposed = await client.query<{
      band: string;
      exposed: string;
    }>(
      `
      SELECT
        CASE
          WHEN warranty_start IS NULL THEN 'unknown'
          WHEN ($1::date - warranty_start) < 180 THEN '0-6m'
          WHEN ($1::date - warranty_start) < 365 THEN '6-12m'
          WHEN ($1::date - warranty_start) < 730 THEN '12-24m'
          WHEN ($1::date - warranty_start) < 1095 THEN '24-36m'
          ELSE '36m+'
        END AS band,
        COUNT(*)::text AS exposed
      FROM warranty_provision_rows
      WHERE warranty_end_date IS NOT NULL AND warranty_end_date > $1::date
      GROUP BY 1
      ORDER BY 1
      `,
      [asOf]
    );

    const claimByBand = new Map(
      claimStats.byAgeBand.map((r) => [r.band, r.claims])
    );

    return {
      asOf,
      exposureUnitYears,
      totalClaims,
      matchedClaims,
      overallClaimPct,
      exposureClaimRate,
      avgClaimCost,
      byMaterialGroup: byGroup.rows.map((r) => {
        const units = Number(r.units) || 0;
        const g = claimByGroup.get(r.material_group);
        const claims = g?.claims ?? 0;
        const thin = claims < 30;
        return {
          materialGroup: r.material_group,
          units,
          claims,
          avgCost: thin ? avgClaimCost : (g?.avgCost ?? null),
          flagged: thin,
        };
      }),
      byAgeBand: byAgeExposed.rows
        .map((r) => {
          const exposed = Number(r.exposed) || 0;
          const claims = claimByBand.get(r.band) ?? 0;
          return {
            band: r.band,
            exposed,
            claims,
            hazard: exposed > 0 ? claims / exposed : null,
          };
        })
        // ORDER BY band is alphabetical (6-12m after 36m+); keep chronological.
        .sort(
          (a, b) =>
            (AGE_BAND_ORDER[a.band] ?? 99) - (AGE_BAND_ORDER[b.band] ?? 99),
        ),
      assumptionBadge: assumptions.usingDefaults
        ? 'Default assumptions in use'
        : 'Saved assumptions in use',
    };
  });
}
