import { withAppClient } from '@/lib/read-model/db';
import { parseAsOf, type SnapQuery } from '@/modules/warranty-provision/server/snap';
import { getAssumptions } from '@/modules/warranty-provision/server/claims';
import { queryWarrantyRates } from '@/modules/warranty-provision/server/rates';
import type { WarrantyForecastResponse } from '@/modules/warranty-provision/types';

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Ponytail: O(months × age-bands) closed-form using aggregate exposure × hazard,
 * not per-unit simulation (2M rows). Upgrade path: materialize monthly hazard by cohort.
 */
export async function queryWarrantyForecast(
  q: SnapQuery & { scenario?: 'base' | 'optimistic' | 'pessimistic' }
): Promise<WarrantyForecastResponse> {
  const asOf = parseAsOf(q.asOf);
  const assumptions = await getAssumptions();
  const forecastStart = assumptions.forecastStart || asOf;
  const rates = await queryWarrantyRates(q);
  const scenario = q.scenario ?? 'base';

  const probMult =
    scenario === 'optimistic'
      ? assumptions.optimisticProbMult
      : scenario === 'pessimistic'
        ? assumptions.pessimisticProbMult
        : 1;
  const costMult =
    scenario === 'optimistic'
      ? assumptions.optimisticCostMult
      : scenario === 'pessimistic'
        ? assumptions.pessimisticCostMult
        : 1;

  const avgCost = (rates.avgClaimCost ?? 0) * costMult;
  // Age-band hazard is claims/exposed over life-to-date → treat as annual, /12.
  // Zero claims → labelled default 1%/yr so model still runs.
  const DEFAULT_ANNUAL = 0.01;
  const ageHazards = rates.byAgeBand.filter(
    (b) => b.hazard != null && b.exposed > 0 && b.claims > 0
  );
  const baseMonthlyHazard =
    ageHazards.length > 0
      ? ageHazards.reduce((a, b) => a + (b.hazard ?? 0), 0) / ageHazards.length / 12
      : rates.matchedClaims > 0 && rates.exposureClaimRate != null
        ? rates.exposureClaimRate / 12
        : DEFAULT_ANNUAL / 12;

  const monthlyHazard = baseMonthlyHazard * probMult;

  return withAppClient(async (client) => {
    const under = await client.query<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM warranty_provision_rows
      WHERE warranty_end_date IS NOT NULL AND warranty_end_date > $1::date
      `,
      [forecastStart]
    );
    const installedUnderWarranty = Number(under.rows[0]?.n ?? 0) || 0;

    const rem = await client.query<{ months: string; n: string }>(
      `
      SELECT
        LEAST(60, GREATEST(0, ((warranty_end_date - $1::date) / 30)))::text AS months,
        COUNT(*)::text AS n
      FROM warranty_provision_rows
      WHERE warranty_end_date IS NOT NULL AND warranty_end_date > $1::date
      GROUP BY 1
      `,
      [forecastStart]
    );
    const remainingMonthsHist = rem.rows.map((r) => ({
      months: Number(r.months) || 0,
      n: Number(r.n) || 0,
    }));

    const monthly: WarrantyForecastResponse['monthly'] = [];
    let cumCost = 0;
    let claims12 = 0;
    let cost12 = 0;
    let cost36 = 0;
    let cost60 = 0;

    for (let m = 1; m <= 60; m++) {
      const periodStart = addMonths(forecastStart, m - 1);
      const covered = remainingMonthsHist
        .filter((b) => b.months >= m)
        .reduce((a, b) => a + b.n, 0);
      const expectedClaims = covered * monthlyHazard;
      const years = (m - 0.5) / 12;
      const cost =
        expectedClaims * avgCost * Math.pow(1 + assumptions.inflationPct / 100, years);
      cumCost += cost;
      monthly.push({
        period: periodStart.slice(0, 7),
        expectedClaims,
        cost,
        cumulativeCost: cumCost,
      });
      if (m <= 12) {
        claims12 += expectedClaims;
        cost12 += cost;
      }
      if (m <= 36) cost36 += cost;
      if (m <= 60) cost60 += cost;
    }

    // Unscale selected-scenario monthly totals → absolute Base, then apply multipliers.
    const baseClaims12 = claims12 / probMult;
    const baseCost12 = cost12 / (probMult * costMult);
    const scenarios = {
      base: { claims12m: baseClaims12, cost12m: baseCost12 },
      optimistic: {
        claims12m: baseClaims12 * assumptions.optimisticProbMult,
        cost12m:
          baseCost12 * assumptions.optimisticProbMult * assumptions.optimisticCostMult,
      },
      pessimistic: {
        claims12m: baseClaims12 * assumptions.pessimisticProbMult,
        cost12m:
          baseCost12 * assumptions.pessimisticProbMult * assumptions.pessimisticCostMult,
      },
    };

    const discount = assumptions.discountPct / 100;
    // Provision always on Base (Ind AS 37 best estimate), not the selected what-if.
    let required = 0;
    for (let m = 1; m <= 60; m++) {
      const row = monthly[m - 1]!;
      const baseCost = row.cost / (probMult * costMult);
      required += baseCost / Math.pow(1 + discount, m / 12);
    }

    const reconciliations: string[] = [];
    if (
      !(
        scenarios.optimistic.cost12m <= scenarios.base.cost12m &&
        scenarios.base.cost12m <= scenarios.pessimistic.cost12m
      )
    ) {
      reconciliations.push('Scenario cost order broken (expected Optimistic ≤ Base ≤ Pessimistic)');
    } else {
      reconciliations.push('Scenario costs ordered Optimistic ≤ Base ≤ Pessimistic');
    }
    reconciliations.push(
      `Exposure unit-years (SNAP grand total) = ${rates.exposureUnitYears.toFixed(2)}`
    );
    reconciliations.push(
      `Matched claims ${rates.matchedClaims} of ${rates.totalClaims} imported`
    );

    return {
      asOf,
      forecastStart,
      scenario,
      kpis: {
        installedUnderWarranty,
        totalClaims: rates.totalClaims,
        overallClaimPct: rates.overallClaimPct,
        avgClaimCost: rates.avgClaimCost,
        expectedClaims12m: claims12,
        projectedCost12m: cost12,
        projectedCost3y: cost36,
        projectedCost5y: cost60,
      },
      monthly,
      scenarios,
      provision: {
        required,
        existing: assumptions.existingProvision,
        gap: required - assumptions.existingProvision,
        note: 'Ind AS 37 / AS 29: provision = best estimate of claims on units sold and still under warranty at the reporting date. Future sales excluded. Discounted at assumption rate.',
      },
      reconciliations,
      methodology: [
        'Coverage uses the SNAP formula (364-day FY span) for exposure unit-years.',
        'Forecast uses age-band average monthly hazard × units still covered each month (aggregate, not per-serial loop).',
        'Small samples (n<30 by material group) are flagged on the Rates view; parent-group fallback applies there.',
        'Inflation compounds monthly from forecast start; provision discounts expected cash flows.',
        'Limitations: claims not yet reported, product-mix shift, and sparse age bands can bias hazards.',
      ],
    };
  });
}
