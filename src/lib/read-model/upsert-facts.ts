import type pg from 'pg';
import type { FactCounts, FactKey } from '@/lib/read-model/types';

export async function upsertFactRows(
  client: pg.PoolClient,
  rows: Array<FactKey & FactCounts>,
  batchSize = 200
): Promise<number> {
  if (rows.length === 0) return 0;

  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((row, rowIndex) => {
      const offset = rowIndex * 14;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14})`
      );
      values.push(
        row.fact_date,
        row.office_id,
        row.call_type,
        row.account,
        row.region,
        row.total,
        row.solved,
        row.cancelled,
        row.open_count,
        row.tech_solved,
        row.deployment_total,
        row.deployment_done,
        row.installation_total,
        row.installation_done
      );
    });

    await client.query(
      `
      INSERT INTO call_metrics_daily (
        fact_date, office_id, call_type, account, region,
        total, solved, cancelled, open_count, tech_solved,
        deployment_total, deployment_done, installation_total, installation_done
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (fact_date, office_id, call_type, account, region) DO UPDATE SET
        total = EXCLUDED.total,
        solved = EXCLUDED.solved,
        cancelled = EXCLUDED.cancelled,
        open_count = EXCLUDED.open_count,
        tech_solved = EXCLUDED.tech_solved,
        deployment_total = EXCLUDED.deployment_total,
        deployment_done = EXCLUDED.deployment_done,
        installation_total = EXCLUDED.installation_total,
        installation_done = EXCLUDED.installation_done,
        synced_at = now()
      `,
      values
    );
    upserted += batch.length;
  }

  return upserted;
}

export async function deleteFactsBeforeYearStart(
  client: pg.PoolClient,
  yearStart: string
): Promise<number> {
  const result = await client.query(
    `DELETE FROM call_metrics_daily WHERE fact_date < $1::date`,
    [yearStart]
  );
  return result.rowCount ?? 0;
}

export async function truncateCurrentYearFacts(
  client: pg.PoolClient,
  yearStart: string
): Promise<number> {
  const result = await client.query(
    `DELETE FROM call_metrics_daily WHERE fact_date >= $1::date`,
    [yearStart]
  );
  return result.rowCount ?? 0;
}

function factDeltaIsZero(delta: FactCounts): boolean {
  return (
    delta.total === 0 &&
    delta.solved === 0 &&
    delta.cancelled === 0 &&
    delta.open_count === 0 &&
    delta.tech_solved === 0 &&
    delta.deployment_total === 0 &&
    delta.deployment_done === 0 &&
    delta.installation_total === 0 &&
    delta.installation_done === 0
  );
}

/** Apply aggregated net deltas in batches (incremental sync — avoids per-row round trips). */
export async function applyNetFactDeltas(
  client: pg.PoolClient,
  entries: Array<{ key: FactKey; delta: FactCounts }>,
  batchSize = 150
): Promise<number> {
  const pending = entries.filter((e) => !factDeltaIsZero(e.delta));
  if (pending.length === 0) return 0;

  let applied = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((entry, rowIndex) => {
      const offset = rowIndex * 14;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14})`
      );
      values.push(
        entry.key.fact_date,
        entry.key.office_id,
        entry.key.call_type,
        entry.key.account,
        entry.key.region,
        entry.delta.total,
        entry.delta.solved,
        entry.delta.cancelled,
        entry.delta.open_count,
        entry.delta.tech_solved,
        entry.delta.deployment_total,
        entry.delta.deployment_done,
        entry.delta.installation_total,
        entry.delta.installation_done
      );
    });

    await client.query(
      `
      INSERT INTO call_metrics_daily (
        fact_date, office_id, call_type, account, region,
        total, solved, cancelled, open_count, tech_solved,
        deployment_total, deployment_done, installation_total, installation_done
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (fact_date, office_id, call_type, account, region) DO UPDATE SET
        total = GREATEST(0, call_metrics_daily.total + EXCLUDED.total),
        solved = GREATEST(0, call_metrics_daily.solved + EXCLUDED.solved),
        cancelled = GREATEST(0, call_metrics_daily.cancelled + EXCLUDED.cancelled),
        open_count = GREATEST(0, call_metrics_daily.open_count + EXCLUDED.open_count),
        tech_solved = GREATEST(0, call_metrics_daily.tech_solved + EXCLUDED.tech_solved),
        deployment_total = GREATEST(0, call_metrics_daily.deployment_total + EXCLUDED.deployment_total),
        deployment_done = GREATEST(0, call_metrics_daily.deployment_done + EXCLUDED.deployment_done),
        installation_total = GREATEST(0, call_metrics_daily.installation_total + EXCLUDED.installation_total),
        installation_done = GREATEST(0, call_metrics_daily.installation_done + EXCLUDED.installation_done),
        synced_at = now()
      `,
      values
    );
    applied += batch.length;
  }

  return applied;
}

export async function applyFactDelta(
  client: pg.PoolClient,
  key: FactKey,
  delta: FactCounts,
  mode: 'add' | 'subtract'
): Promise<void> {
  const sign = mode === 'add' ? 1 : -1;

  if (mode === 'subtract') {
    await client.query(
      `
      UPDATE call_metrics_daily
      SET
        total = GREATEST(0, total + $6),
        solved = GREATEST(0, solved + $7),
        cancelled = GREATEST(0, cancelled + $8),
        open_count = GREATEST(0, open_count + $9),
        tech_solved = GREATEST(0, tech_solved + $10),
        deployment_total = GREATEST(0, deployment_total + $11),
        deployment_done = GREATEST(0, deployment_done + $12),
        installation_total = GREATEST(0, installation_total + $13),
        installation_done = GREATEST(0, installation_done + $14),
        synced_at = now()
      WHERE fact_date = $1
        AND office_id = $2
        AND call_type = $3
        AND account = $4
        AND region = $5
      `,
      [
        key.fact_date,
        key.office_id,
        key.call_type,
        key.account,
        key.region,
        sign * delta.total,
        sign * delta.solved,
        sign * delta.cancelled,
        sign * delta.open_count,
        sign * delta.tech_solved,
        sign * delta.deployment_total,
        sign * delta.deployment_done,
        sign * delta.installation_total,
        sign * delta.installation_done,
      ]
    );
    return;
  }

  await client.query(
    `
    INSERT INTO call_metrics_daily (
      fact_date, office_id, call_type, account, region,
      total, solved, cancelled, open_count, tech_solved,
      deployment_total, deployment_done, installation_total, installation_done
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (fact_date, office_id, call_type, account, region) DO UPDATE SET
      total = call_metrics_daily.total + EXCLUDED.total,
      solved = call_metrics_daily.solved + EXCLUDED.solved,
      cancelled = call_metrics_daily.cancelled + EXCLUDED.cancelled,
      open_count = call_metrics_daily.open_count + EXCLUDED.open_count,
      tech_solved = call_metrics_daily.tech_solved + EXCLUDED.tech_solved,
      deployment_total = call_metrics_daily.deployment_total + EXCLUDED.deployment_total,
      deployment_done = call_metrics_daily.deployment_done + EXCLUDED.deployment_done,
      installation_total = call_metrics_daily.installation_total + EXCLUDED.installation_total,
      installation_done = call_metrics_daily.installation_done + EXCLUDED.installation_done,
      synced_at = now()
    `,
    [
      key.fact_date,
      key.office_id,
      key.call_type,
      key.account,
      key.region,
      delta.total,
      delta.solved,
      delta.cancelled,
      delta.open_count,
      delta.tech_solved,
      delta.deployment_total,
      delta.deployment_done,
      delta.installation_total,
      delta.installation_done,
    ]
  );
}
