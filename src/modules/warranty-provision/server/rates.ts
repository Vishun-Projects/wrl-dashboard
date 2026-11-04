import { withAppClient } from '@/lib/read-model/db';
import { parseAsOf, snapExposureUnitYears, type SnapQuery } from '@/modules/warranty-provision/server/snap';
import { getAssumptions } from '@/modules/warranty-provision/server/claims';
import type { WarrantyRatesResponse } from '@/modules/warranty-provision/types';

export async function queryWarrantyRates(q: SnapQuery): Promise<WarrantyRatesResponse> {
  const asOf = parseAsOf(q.asOf);
  const exposureUnitYears = await snapExposureUnitYears({ ...q, asOf });
  const assumptions = await getAssumptions();

  return withAppClient(async (client) => {
    const totals = await client.query<{
      total_claims: string;
      matched: string;
      avg_cost: string | null;
    }>(`
      SELECT
        COUNT(*)::text AS total_claims,
        COUNT(*) FILTER (WHERE match_status = 'matched')::text AS matched,
        AVG(total_cost) FILTER (WHERE total_cost IS NOT NULL)::text AS avg_cost
      FROM warranty_claims
    `);
    const totalClaims = Number(totals.rows[0]?.total_claims ?? 0) || 0;
    const matchedClaims = Number(totals.rows[0]?.matched ?? 0) || 0;
    const avgClaimCost =
      totals.rows[0]?.avg_cost != null ? Number(totals.rows[0].avg_cost) : null;

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

    const byGroup = await client.query<{
      material_group: string;
      units: string;
      claims: string;
      avg_cost: string | null;
    }>(
      `
      WITH units AS (
        SELECT material_group, COUNT(*) AS units
        FROM warranty_provision_rows
        WHERE material_group <> ''
        GROUP BY material_group
      ),
      claims AS (
        SELECT u.material_group, COUNT(*) AS claims, AVG(c.total_cost) AS avg_cost
        FROM warranty_claims c
        JOIN warranty_provision_rows u ON u.id = c.unit_id
        WHERE c.match_status = 'matched'
        GROUP BY u.material_group
      )
      SELECT
        units.material_group,
        units.units::text,
        COALESCE(claims.claims, 0)::text AS claims,
        claims.avg_cost::text AS avg_cost
      FROM units
      LEFT JOIN claims ON claims.material_group = units.material_group
      ORDER BY units.units DESC
      LIMIT 50
      `
    );

    const byAge = await client.query<{
      band: string;
      exposed: string;
      claims: string;
    }>(
      `
      WITH bands AS (
        SELECT
          CASE
            WHEN warranty_start IS NULL THEN 'unknown'
            WHEN ($1::date - warranty_start) < 180 THEN '0-6m'
            WHEN ($1::date - warranty_start) < 365 THEN '6-12m'
            WHEN ($1::date - warranty_start) < 730 THEN '12-24m'
            WHEN ($1::date - warranty_start) < 1095 THEN '24-36m'
            ELSE '36m+'
          END AS band,
          COUNT(*) AS exposed
        FROM warranty_provision_rows
        WHERE warranty_end_date IS NOT NULL AND warranty_end_date > $1::date
        GROUP BY 1
      ),
      claim_bands AS (
        SELECT
          CASE
            WHEN u.warranty_start IS NULL OR c.claim_date IS NULL THEN 'unknown'
            WHEN (c.claim_date - u.warranty_start) < 180 THEN '0-6m'
            WHEN (c.claim_date - u.warranty_start) < 365 THEN '6-12m'
            WHEN (c.claim_date - u.warranty_start) < 730 THEN '12-24m'
            WHEN (c.claim_date - u.warranty_start) < 1095 THEN '24-36m'
            ELSE '36m+'
          END AS band,
          COUNT(*) AS claims
        FROM warranty_claims c
        JOIN warranty_provision_rows u ON u.id = c.unit_id
        WHERE c.match_status = 'matched'
        GROUP BY 1
      )
      SELECT
        bands.band,
        bands.exposed::text,
        COALESCE(claim_bands.claims, 0)::text AS claims
      FROM bands
      LEFT JOIN claim_bands ON claim_bands.band = bands.band
      ORDER BY bands.band
      `,
      [asOf]
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
        const claims = Number(r.claims) || 0;
        const thin = claims < 30;
        return {
          materialGroup: r.material_group,
          units,
          claims,
          avgCost: thin
            ? avgClaimCost
            : r.avg_cost != null
              ? Number(r.avg_cost)
              : null,
          flagged: thin,
        };
      }),
      byAgeBand: byAge.rows.map((r) => {
        const exposed = Number(r.exposed) || 0;
        const claims = Number(r.claims) || 0;
        return {
          band: r.band,
          exposed,
          claims,
          hazard: exposed > 0 ? claims / exposed : null,
        };
      }),
      assumptionBadge: assumptions.usingDefaults
        ? 'Default assumptions in use'
        : 'Saved assumptions in use',
    };
  });
}
