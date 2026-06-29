import { parseClientDate } from '@/lib/mis-client-import/parse-dates';
import { shouldSkipCadburyImportRow } from '@/lib/mis-client-import/cadbury-filters';
import { isKnownZone, normalizeClientRegion } from '@/lib/mis-client-import/region';
import type {
  ImportRowError,
  MisClientSourceConfig,
  NormalizedClientRow,
  StatusBucket,
} from '@/lib/mis-client-import/types';

function normalizeStatusKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildStatusLookup(config: MisClientSourceConfig): Map<string, { bucket: StatusBucket; label: string }> {
  const map = new Map<string, { bucket: StatusBucket; label: string }>();
  for (const row of config.statusMappings) {
    map.set(normalizeStatusKey(row.client_status), {
      bucket: row.status_bucket,
      label: row.status_label,
    });
  }
  return map;
}

function buildStateLookup(
  config: MisClientSourceConfig
): Map<string, { planCode: string | null; region: string | null }> {
  const map = new Map<string, { planCode: string | null; region: string | null }>();
  for (const row of config.stateMappings) {
    map.set(row.client_state.trim().toLowerCase(), {
      planCode: row.plan_code,
      region: row.region_override,
    });
  }
  return map;
}

function getMappedValue(
  rawRow: Record<string, string>,
  config: MisClientSourceConfig,
  crmField: string
): string {
  for (const mapping of config.fieldMappings) {
    if (mapping.crm_field === crmField) {
      return rawRow[mapping.client_column] ?? '';
    }
  }
  return '';
}

/** Read a value from raw import row when not covered by field mappings. */
function pickRawColumn(rawRow: Record<string, string>, columns: string[]): string {
  for (const column of columns) {
    const value = rawRow[column]?.trim();
    if (value) return value;
  }
  return '';
}

const ZONE_SOURCE_COLUMNS = ['Branchname', 'Branch Name', 'Regionname', 'Region', 'Zone'];
const STATE_SOURCE_COLUMNS = ['Entity Name', 'State'];

function isOpenBucket(bucket: StatusBucket): boolean {
  return bucket === 'open_unallocated' || bucket === 'assigned';
}

function isPartPending(complaint: string | null, bucket: StatusBucket): boolean {
  if (!isOpenBucket(bucket)) return false;
  return (complaint ?? '').toUpperCase().includes('PART');
}

export function normalizeClientRows(
  config: MisClientSourceConfig,
  rawRows: Record<string, string>[]
): { rows: NormalizedClientRow[]; errors: ImportRowError[]; warnings: string[] } {
  const statusLookup = buildStatusLookup(config);
  const stateLookup = buildStateLookup(config);
  const rows: NormalizedClientRow[] = [];
  const errors: ImportRowError[] = [];
  const warnings: string[] = [];
  const unknownStatuses = new Set<string>();
  let excludedByServiceProvider = 0;

  rawRows.forEach((rawRow, index) => {
    const rowNum = index + 2;

    if (shouldSkipCadburyImportRow(config.code, rawRow)) {
      excludedByServiceProvider++;
      return;
    }

    const callKey = (rawRow[config.call_key_column] ?? '').trim();
    if (!callKey) {
      errors.push({ row: rowNum, message: 'Missing call key' });
      return;
    }

    const statusRaw = getMappedValue(rawRow, config, 'status_label').trim();
    const statusEntry = statusLookup.get(normalizeStatusKey(statusRaw));
    if (!statusEntry) {
      unknownStatuses.add(statusRaw || '(empty)');
      errors.push({ row: rowNum, message: `Unknown status: ${statusRaw || '(empty)'}` });
      return;
    }

    const loggedAt = parseClientDate(getMappedValue(rawRow, config, 'logged_at'));
    const solvedAt = parseClientDate(getMappedValue(rawRow, config, 'solved_at'));
    const stateRaw =
      getMappedValue(rawRow, config, 'state').trim() ||
      pickRawColumn(rawRow, STATE_SOURCE_COLUMNS) ||
      null;
    const stateKey = stateRaw?.toLowerCase() ?? '';
    const stateInfo = stateLookup.get(stateKey);

    let region = normalizeClientRegion(getMappedValue(rawRow, config, 'region'));
    if (!isKnownZone(region)) {
      for (const column of ZONE_SOURCE_COLUMNS) {
        const candidate = normalizeClientRegion(rawRow[column]);
        if (isKnownZone(candidate)) {
          region = candidate;
          break;
        }
      }
    }
    if (stateInfo?.region) {
      region = normalizeClientRegion(stateInfo.region);
    } else if (stateRaw && !isKnownZone(region)) {
      region = normalizeClientRegion(stateRaw);
    }

    const branchLabel =
      getMappedValue(rawRow, config, 'branch_name').trim() ||
      getMappedValue(rawRow, config, 'city').trim() ||
      null;
    const complaint = getMappedValue(rawRow, config, 'complaint').trim() || null;
    const callType = getMappedValue(rawRow, config, 'call_type').trim() || 'BREAKDOWN';
    const engineerName = getMappedValue(rawRow, config, 'engineer_name').trim() || null;

    rows.push({
      call_key: callKey,
      logged_at: loggedAt,
      solved_at: solvedAt,
      status_bucket: statusEntry.bucket,
      status_label: statusEntry.label,
      region,
      state: stateRaw,
      branch_label: branchLabel,
      complaint,
      call_type: callType,
      is_part_pending: isPartPending(complaint, statusEntry.bucket),
      engineer_name: engineerName,
      raw: rawRow,
    });
  });

  if (unknownStatuses.size > 0) {
    warnings.push(`Unknown statuses encountered: ${[...unknownStatuses].join(', ')}`);
  }

  if (excludedByServiceProvider > 0) {
    warnings.push(
      `Excluded ${excludedByServiceProvider.toLocaleString()} rows for non-WRL service providers ` +
        '(Span Spectrum Pvt Ltd, Punjab Refrigeration).'
    );
  }

  return { rows, errors, warnings };
}
