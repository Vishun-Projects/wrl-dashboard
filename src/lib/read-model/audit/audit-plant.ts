import type pg from 'pg';
import type { AuditOptions, PlantAuditSummary } from '@/lib/read-model/audit/types';

const ALLOWED_ZONES = new Set(['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']);

function emptyPlantSummary(): PlantAuditSummary {
  return {
    rows_checked: 0,
    orphan_office_ids: 0,
    invalid_zones: 0,
  };
}

export async function auditPlantMappings(
  client: pg.PoolClient,
  opts: Pick<AuditOptions, 'onMismatch' | 'onProgress'>
): Promise<PlantAuditSummary> {
  const summary = emptyPlantSummary();
  opts.onProgress?.('Plant mappings audit: checking FK integrity');

  const res = await client.query<{ office_id: string; region_zone: string }>(
    `SELECT office_id, region_zone FROM mis_plant_region_mappings ORDER BY office_id`
  );
  summary.rows_checked = res.rows.length;

  const officeRes = await client.query<{ ncode: string }>(`SELECT ncode FROM dim_offices`);
  const officeIds = new Set(officeRes.rows.map((r) => String(r.ncode)));

  for (const row of res.rows) {
    const officeId = String(row.office_id);
    if (!officeIds.has(officeId)) {
      summary.orphan_office_ids++;
      opts.onMismatch?.({
        phase: 'plant',
        entity: 'mis_plant_region_mappings',
        kind: 'orphan_fk',
        key: officeId,
        details: { office_id: officeId, region_zone: row.region_zone },
      });
    }
    if (!ALLOWED_ZONES.has(String(row.region_zone).trim())) {
      summary.invalid_zones++;
      opts.onMismatch?.({
        phase: 'plant',
        entity: 'mis_plant_region_mappings',
        kind: 'invalid_zone',
        key: officeId,
        details: { region_zone: row.region_zone },
      });
    }
  }

  opts.onProgress?.(
    `Plant mappings audit done — rows ${summary.rows_checked}, orphans ${summary.orphan_office_ids}, invalid zones ${summary.invalid_zones}`
  );

  return summary;
}
